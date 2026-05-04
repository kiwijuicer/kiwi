import { existsSync, readFileSync } from "fs";
import path from "path";
import { LocalShellRunnerAdapter, StubPlannerProvider, runPlannerProviderWithRetries } from "@ai-kiwi/adapters";
import { createWorktreeSandbox, SandboxCommandPolicy } from "@ai-kiwi/sandbox";
import {
  assertStepDependenciesCompleted,
  buildDeterministicTaskGraph,
  commandProfileForStep,
  commandProfileToExecutionPolicy,
  createInitiativeFromInput,
  finalizeRun,
  generateRunId,
  getRunStatusSummary,
  handleA2AEnvelope,
  listStepAttemptEvidence,
  loadEvidenceManifest,
  loadApprovalDecision,
  loadInitiative,
  loadPolicy,
  loadRegistry,
  loadRunManifest,
  loadTaskGraph,
  noopCommand,
  readAuditEvents,
  recordApprovalDecision,
  refreshRunStatusFromAttempts,
  resolveRunArtifactPath,
  savePlannedRun,
  scheduleStepAttempt,
  splitCommandLine,
  StepAttemptOrchestrator,
  withRunLock,
  writeEvidenceManifest,
  writeOperatorSnapshot,
  writePlannerCostReport,
} from "@ai-kiwi/core";

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function textContent(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function selectPlannerModel(cwd: string) {
  const registry = loadRegistry(path.join(cwd, "model-registry.yaml"));
  const model = registry.models.find(
    (entry) => entry.enabled && entry.roles.includes("planner") && entry.capability === "frontier",
  ) ?? registry.models.find((entry) => entry.enabled && entry.roles.includes("planner"));
  if (!model) throw new Error("No enabled planner model found");
  if (model.provider !== "stub") {
    throw new Error(`Planner provider '${model.provider}' is not supported yet`);
  }
  return model;
}

async function planTool(args: Record<string, unknown>, cwd: string): Promise<unknown> {
  const rawInput = String(args.ticket ?? args.rawInput ?? "");
  if (!rawInput) throw new Error("kiwi_plan requires ticket or rawInput");
  const now = new Date();
  const runId = generateRunId(now);
  const policy = loadPolicy(path.join(cwd, "kiwi-policy.yaml"));
  const initiative = createInitiativeFromInput({
    rawInput,
    repoPath: cwd,
    source: "mcp",
    riskProfile: args.riskProfile === "production" ? "production" : "dev",
    budgetProfile: args.budgetProfile === "tiny" ? "tiny" : "normal",
    now,
  });
  const plannerModel = selectPlannerModel(cwd);
  const provider = new StubPlannerProvider({
    buildTaskGraph: buildDeterministicTaskGraph,
    now: () => now,
  });
  const plannerOutput = await runPlannerProviderWithRetries(
    provider,
    {
      runId,
      initiative,
      policy,
      requestedAt: now.toISOString(),
    },
    { maxAttempts: 2 },
  );
  savePlannedRun({
    runId,
    initiative,
    taskGraph: plannerOutput.taskGraph,
    plannerInput: { runId, initiative, policy, requestedAt: now.toISOString() },
    plannerOutput: {
      plannerModelId: plannerModel.id,
      budget: { profile: initiative.budgetProfile, remainingUsdEstimate: null },
      ...plannerOutput,
    },
    cwd,
    now,
  });
  writePlannerCostReport(cwd, runId, {
    schemaVersion: "1",
    runId,
    plannerModelId: plannerModel.id,
    providerName: plannerOutput.providerName,
    budgetProfile: initiative.budgetProfile,
    budgetRemainingUsdEstimate: null,
    attemptsUsed: plannerOutput.retry.attemptsUsed,
    invalidAttempts: plannerOutput.retry.invalidAttempts,
    modelUsage: plannerOutput.modelUsage,
    cost: plannerOutput.cost,
    createdAt: now.toISOString(),
  });
  return { runId, planId: plannerOutput.taskGraph.planId, steps: plannerOutput.taskGraph.steps.length };
}

async function runStepTool(args: Record<string, unknown>, cwd: string): Promise<unknown> {
  const runId = String(args.runId ?? "");
  const stepId = String(args.stepId ?? "");
  if (!runId || !stepId) throw new Error("kiwi_run_step requires runId and stepId");

  return withRunLock(
    {
      cwd,
      runId,
      operation: `mcp_run_step:${stepId}`,
    },
    async () => {
      const policy = loadPolicy(path.join(cwd, "kiwi-policy.yaml"));
      const initiative = loadInitiative(runId, cwd);
      const taskGraph = loadTaskGraph(runId, cwd);
      const step = taskGraph.steps.find((entry) => entry.stepId === stepId);
      if (!step) throw new Error(`Step not found: ${stepId}`);
      assertStepDependenciesCompleted({
        cwd,
        runId,
        stepId,
        dependsOn: step.dependsOn,
      });

      const decision = scheduleStepAttempt({
        cwd,
        runId,
        step,
        initiative,
        budgetProfile: initiative.budgetProfile,
        budgetRemainingUsdEstimate: null,
        blastRadius: initiative.riskProfile === "production" ? "high" : "low",
        securitySensitivity: initiative.riskProfile === "production" ? "high" : "low",
        contextSize: "small",
        runnerAvailability: ["local-shell"],
      });
      if (decision.status !== "scheduled") throw new Error(decision.blockedReason ?? "scheduler blocked");

      const approval = loadApprovalDecision({ cwd, runId, attemptId: decision.attemptId });
      const sandbox = createWorktreeSandbox({ cwd, runId, attemptId: decision.attemptId });
      const profile = commandProfileForStep(policy, step.type);
      const commandPolicy = commandProfileToExecutionPolicy(profile) as SandboxCommandPolicy;
      const command = typeof args.command === "string" ? splitCommandLine(args.command) : noopCommand();
      const result = await new StepAttemptOrchestrator<SandboxCommandPolicy>().execute({
        cwd,
        step,
        schedulerDecision: decision,
        runner: new LocalShellRunnerAdapter(),
        worktreePath: sandbox.worktreePath,
        stepPrompt: step.title,
        allowedTools: ["shell"],
        command,
        commandPolicy,
        approved: Boolean(args.approved) || approval?.state === "auto",
      });
      const run = refreshRunStatusFromAttempts({ cwd, runId });
      return {
        attemptId: decision.attemptId,
        status: result.status,
        nextAction: result.nextAction,
        runStatus: run.status,
      };
    },
  );
}

interface McpResourceContent {
  uri: string;
  text: string;
  mimeType?: string;
}

function readJsonRunArtifact(runId: string, ref: string, cwd: string): unknown {
  const target = resolveRunArtifactPath(runId, ref, cwd);
  if (!existsSync(target)) throw new Error(`Artifact not found: ${ref}`);
  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}

function readTextRunArtifact(runId: string, ref: string, cwd: string): string {
  const target = resolveRunArtifactPath(runId, ref, cwd);
  if (!existsSync(target)) throw new Error(`Artifact not found: ${ref}`);
  return readFileSync(target, "utf-8");
}

function asContent(uri: string, value: unknown, mimeType?: string): McpResourceContent {
  const content: McpResourceContent = {
    uri,
    text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
  };
  if (mimeType) content.mimeType = mimeType;
  return content;
}

function readResource(uri: string, cwd: string): McpResourceContent {
  if (uri === "kiwi://runs") return asContent(uri, getRunStatusSummary(cwd), "application/json");
  const runMatch = uri.match(/^kiwi:\/\/runs\/([^/]+)(?:\/(.+))?$/);
  const runId = runMatch?.[1];
  const tail = runMatch?.[2] ?? "";
  if (!runId) throw new Error(`Unsupported resource URI: ${uri}`);

  if (!tail) return asContent(uri, getRunStatusSummary(cwd, runId), "application/json");
  if (tail === "manifest") return asContent(uri, loadRunManifest(runId, cwd), "application/json");
  if (tail === "initiative") return asContent(uri, loadInitiative(runId, cwd), "application/json");
  if (tail === "task-graph") return asContent(uri, loadTaskGraph(runId, cwd), "application/json");
  if (tail === "planner-input") return asContent(uri, readJsonRunArtifact(runId, "plan/planner-input.json", cwd), "application/json");
  if (tail === "planner-output") return asContent(uri, readJsonRunArtifact(runId, "plan/planner-output.json", cwd), "application/json");
  if (tail === "planner-cost") return asContent(uri, readJsonRunArtifact(runId, "plan/cost-report.json", cwd), "application/json");
  if (tail === "attempts") return asContent(uri, listStepAttemptEvidence(cwd, runId), "application/json");
  if (tail === "final-verdict") return asContent(uri, readJsonRunArtifact(runId, "final/final-verdict.json", cwd), "application/json");
  if (tail === "final-cost-report") return asContent(uri, readJsonRunArtifact(runId, "final/final-cost-report.json", cwd), "application/json");
  if (tail === "final-summary") return asContent(uri, readTextRunArtifact(runId, "final/final-summary.md", cwd), "text/markdown");
  if (tail === "audit") return asContent(uri, readAuditEvents(cwd, runId), "application/json");
  if (tail === "audit-snapshot") return asContent(uri, readJsonRunArtifact(runId, "final/audit-events.json", cwd), "application/json");
  if (tail === "evidence-manifest") return asContent(uri, loadEvidenceManifest({ cwd, runId }), "application/json");
  if (tail === "operator-snapshot") return asContent(uri, readTextRunArtifact(runId, "operator/index.html", cwd), "text/html");

  const attemptMatch = tail.match(/^attempts\/([^/]+)\/([^/]+)(?:\/(.+))?$/);
  if (attemptMatch?.[1] && attemptMatch[2]) {
    const stepId = attemptMatch[1];
    const attemptId = attemptMatch[2];
    const section = attemptMatch[3] ?? "";
    if (!section) {
      return asContent(
        uri,
        readJsonRunArtifact(runId, `steps/${stepId}/${attemptId}/attempt.json`, cwd),
        "application/json",
      );
    }
    if (section === "gate-results") {
      return asContent(
        uri,
        readJsonRunArtifact(runId, `steps/${stepId}/${attemptId}/gate-results.json`, cwd),
        "application/json",
      );
    }
    if (section === "review-verdict") {
      return asContent(
        uri,
        readJsonRunArtifact(runId, `steps/${stepId}/${attemptId}/artifacts/review-report.json`, cwd),
        "application/json",
      );
    }
    if (section === "attempt-summary") {
      return asContent(
        uri,
        readJsonRunArtifact(runId, `steps/${stepId}/${attemptId}/artifacts/attempt-summary.json`, cwd),
        "application/json",
      );
    }
  }

  const artifactMatch = tail.match(/^artifacts\/(.+)$/);
  if (artifactMatch?.[1]) {
    const ref = decodeURIComponent(artifactMatch[1]);
    return asContent(uri, readTextRunArtifact(runId, ref, cwd), "text/plain");
  }

  throw new Error(`Unsupported resource URI: ${uri}`);
}

async function callTool(name: string, args: Record<string, unknown>, cwd: string): Promise<unknown> {
  switch (name) {
    case "kiwi_plan":
      return planTool(args, cwd);
    case "kiwi_status":
      return getRunStatusSummary(cwd, typeof args.runId === "string" ? args.runId : undefined);
    case "kiwi_run_step":
      return runStepTool(args, cwd);
    case "kiwi_finalize":
      return withRunLock(
        { cwd, runId: String(args.runId ?? ""), operation: "mcp_finalize" },
        () => finalizeRun({ cwd, runId: String(args.runId ?? "") }),
      );
    case "kiwi_request_approval":
      return withRunLock(
        {
          cwd,
          runId: String(args.runId ?? ""),
          operation: `mcp_approval:${String(args.attemptId ?? "")}`,
        },
        () =>
          recordApprovalDecision({
            cwd,
            runId: String(args.runId ?? ""),
            attemptId: String(args.attemptId ?? ""),
            reason: String(args.reason ?? "Approved through MCP"),
            approvedBy: String(args.approvedBy ?? "mcp-operator"),
          }),
      );
    case "kiwi_evidence_manifest":
      return withRunLock(
        { cwd, runId: String(args.runId ?? ""), operation: "mcp_evidence_manifest" },
        () => writeEvidenceManifest({ cwd, runId: String(args.runId ?? "") }),
      );
    case "kiwi_operator_snapshot":
      return withRunLock(
        { cwd, runId: String(args.runId ?? ""), operation: "mcp_operator_snapshot" },
        () => writeOperatorSnapshot({ cwd, runId: String(args.runId ?? "") }),
      );
    case "kiwi_a2a_receive":
      return handleA2AEnvelope({
        cwd,
        envelope: args.envelope,
        policy: {
          mode: args.loopback === true ? "loopback" : "disabled",
          localAgentId: typeof args.localAgentId === "string" ? args.localAgentId : "ai-kiwi-local",
          trustedAgentIds: Array.isArray(args.trustedAgentIds)
            ? args.trustedAgentIds.filter((entry): entry is string => typeof entry === "string")
            : [],
        },
      }).decision;
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const RUN_ID_SCHEMA = {
  type: "object",
  properties: {
    runId: { type: "string" },
  },
  required: ["runId"],
} as const;

const TOOLS = [
  {
    name: "kiwi_plan",
    description: "Create a planned ai-kiwi run",
    inputSchema: {
      type: "object",
      properties: {
        ticket: { type: "string" },
        rawInput: { type: "string" },
        riskProfile: { type: "string", enum: ["dev", "production"] },
        budgetProfile: { type: "string", enum: ["tiny", "normal"] },
      },
    },
  },
  {
    name: "kiwi_status",
    description: "Read run status",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
      },
    },
  },
  {
    name: "kiwi_run_step",
    description: "Execute a planned step through policy gates",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        stepId: { type: "string" },
        command: { type: "string" },
        approved: { type: "boolean" },
      },
      required: ["runId", "stepId"],
    },
  },
  { name: "kiwi_finalize", description: "Finalize a run", inputSchema: RUN_ID_SCHEMA },
  {
    name: "kiwi_request_approval",
    description: "Record an approval decision",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        attemptId: { type: "string" },
        reason: { type: "string" },
        approvedBy: { type: "string" },
      },
      required: ["runId", "attemptId"],
    },
  },
  { name: "kiwi_evidence_manifest", description: "Write evidence manifest and audit snapshot", inputSchema: RUN_ID_SCHEMA },
  { name: "kiwi_operator_snapshot", description: "Write local operator HTML snapshot", inputSchema: RUN_ID_SCHEMA },
  {
    name: "kiwi_a2a_receive",
    description: "Validate and optionally accept an A2A envelope into the local loopback inbox",
    inputSchema: {
      type: "object",
      properties: {
        envelope: { type: "object" },
        loopback: { type: "boolean" },
        localAgentId: { type: "string" },
        trustedAgentIds: { type: "array", items: { type: "string" } },
      },
      required: ["envelope"],
    },
  },
] as const;

export async function handleMcpRequest(
  request: JsonRpcRequest,
  cwd: string = process.cwd(),
): Promise<JsonRpcResponse> {
  const id = request.id ?? null;
  try {
    if (request.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "ai-kiwi", version: "0.1.0" },
          capabilities: { resources: {}, tools: {} },
        },
      };
    }
    if (request.method === "resources/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          resources: [
            { uri: "kiwi://runs", name: "Runs" },
            { uri: "kiwi://runs/{runId}", name: "Run Status" },
            { uri: "kiwi://runs/{runId}/manifest", name: "Run Manifest" },
            { uri: "kiwi://runs/{runId}/initiative", name: "Initiative" },
            { uri: "kiwi://runs/{runId}/task-graph", name: "TaskGraph" },
            { uri: "kiwi://runs/{runId}/planner-input", name: "Planner Input" },
            { uri: "kiwi://runs/{runId}/planner-output", name: "Planner Output" },
            { uri: "kiwi://runs/{runId}/planner-cost", name: "Planner Cost" },
            { uri: "kiwi://runs/{runId}/attempts", name: "Step Attempts" },
            { uri: "kiwi://runs/{runId}/attempts/{stepId}/{attemptId}", name: "StepAttempt" },
            { uri: "kiwi://runs/{runId}/attempts/{stepId}/{attemptId}/gate-results", name: "Gate Results" },
            { uri: "kiwi://runs/{runId}/attempts/{stepId}/{attemptId}/review-verdict", name: "Review Verdict" },
            { uri: "kiwi://runs/{runId}/attempts/{stepId}/{attemptId}/attempt-summary", name: "Attempt Summary" },
            { uri: "kiwi://runs/{runId}/final-verdict", name: "Final Verdict" },
            { uri: "kiwi://runs/{runId}/final-cost-report", name: "Final Cost Report" },
            { uri: "kiwi://runs/{runId}/final-summary", name: "Final Summary" },
            { uri: "kiwi://runs/{runId}/audit", name: "Audit Events" },
            { uri: "kiwi://runs/{runId}/audit-snapshot", name: "Audit Snapshot" },
            { uri: "kiwi://runs/{runId}/evidence-manifest", name: "Evidence Manifest" },
            { uri: "kiwi://runs/{runId}/operator-snapshot", name: "Operator Snapshot" },
            { uri: "kiwi://runs/{runId}/artifacts/{artifactRef}", name: "Artifact" },
          ],
        },
      };
    }
    if (request.method === "resources/read") {
      const params = asRecord(request.params);
      return { jsonrpc: "2.0", id, result: { contents: [readResource(String(params.uri), cwd)] } };
    }
    if (request.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS,
        },
      };
    }
    if (request.method === "tools/call") {
      const params = asRecord(request.params);
      const result = await callTool(String(params.name), asRecord(params.arguments), cwd);
      return { jsonrpc: "2.0", id, result: textContent(result) };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${request.method}` } };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function encodeMessage(payload: unknown): string {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`;
}

export function startMcpServer(cwd: string = process.cwd()): void {
  let buffer = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    void (async () => {
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator < 0) return;
      const header = buffer.slice(0, separator);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match?.[1]) return;
      const length = Number(match[1]);
      const start = separator + 4;
      const body = buffer.slice(start, start + length);
      if (body.length < length) return;
      buffer = buffer.slice(start + length);
      const response = await handleMcpRequest(JSON.parse(body) as JsonRpcRequest, cwd);
      process.stdout.write(encodeMessage(response));
    })();
  });
}

if (require.main === module) {
  startMcpServer();
}
