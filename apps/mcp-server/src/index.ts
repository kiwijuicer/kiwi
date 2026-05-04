import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import path from "path";
import { LocalShellRunnerAdapter, StubPlannerProvider, runPlannerProviderWithRetries } from "@kiwi/adapters";
import { ProtocolEnvelopeKindSchema } from "@kiwi/contracts";
import { createWorktreeSandbox, SandboxCommandPolicy } from "@kiwi/sandbox";
import {
  acceptA2AHandoff,
  addA2ATrustedPeer,
  assertStepDependenciesCompleted,
  buildDeterministicTaskGraph,
  commandProfileForStep,
  commandProfileToExecutionPolicy,
  createInitiativeFromInput,
  finalizeRun,
  generateRunId,
  getRunStatusSummary,
  handleA2AEnvelope,
  listA2AInbox,
  listStepAttemptEvidence,
  loadA2AConfig,
  loadEvidenceManifest,
  loadApprovalDecision,
  loadInitiative,
  loadPolicy,
  loadRegistry,
  loadRunManifest,
  loadTaskGraph,
  noopCommand,
  publishA2AEnvelope,
  readAuditEvents,
  recordApprovalDecision,
  refreshRunStatusFromAttempts,
  removeA2ATrustedPeer,
  resolveWorkspace,
  WorkspaceResolution,
  resolveRunArtifactPath,
  savePlannedRun,
  scheduleStepAttempt,
  setA2AEnabled,
  splitCommandLine,
  StepAttemptOrchestrator,
  syncA2AFilesystem,
  withRunLock,
  writeEvidenceManifest,
  writeOperatorSnapshot,
  writePlannerCostReport,
} from "@kiwi/core";

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

function workspaceArgs(args: Record<string, unknown>, cwd: string, requireRepo: boolean): WorkspaceResolution {
  const workspacePath = typeof args.workspacePath === "string" ? args.workspacePath : undefined;
  const repo = typeof args.repoId === "string"
    ? args.repoId
    : typeof args.repoPath === "string"
      ? args.repoPath
      : undefined;
  const input: Parameters<typeof resolveWorkspace>[0] = {
    cwd,
    requireRepo,
  };
  if (workspacePath) input.workspacePath = workspacePath;
  if (repo) input.repo = repo;
  return resolveWorkspace(input);
}

async function planTool(args: Record<string, unknown>, cwd: string): Promise<unknown> {
  const rawInput = String(args.ticket ?? args.rawInput ?? "");
  if (!rawInput) throw new Error("kiwi_plan requires ticket or rawInput");
  const workspace = workspaceArgs(args, cwd, true);
  const repo = workspace.repo!;
  const now = new Date();
  const runId = generateRunId(now);
  const policy = loadPolicy(path.join(workspace.workspacePath, "kiwi-policy.yaml"));
  const initiative = createInitiativeFromInput({
    rawInput,
    repoPath: repo.path,
    source: "mcp",
    riskProfile: args.riskProfile === "production" ? "production" : "dev",
    budgetProfile: args.budgetProfile === "tiny" ? "tiny" : "normal",
    now,
  });
  const plannerModel = selectPlannerModel(workspace.workspacePath);
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
    cwd: workspace.workspacePath,
    workspacePath: workspace.workspacePath,
    repoId: repo.id,
    repoPath: repo.path,
    now,
  });
  writePlannerCostReport(workspace.workspacePath, runId, {
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
  return {
    runId,
    planId: plannerOutput.taskGraph.planId,
    steps: plannerOutput.taskGraph.steps.length,
    workspacePath: workspace.workspacePath,
    repoId: repo.id,
    repoPath: repo.path,
  };
}

async function runStepTool(args: Record<string, unknown>, cwd: string): Promise<unknown> {
  const runId = String(args.runId ?? "");
  const stepId = String(args.stepId ?? "");
  if (!runId || !stepId) throw new Error("kiwi_run_step requires runId and stepId");
  const workspace = workspaceArgs(args, cwd, false);

  return withRunLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: `mcp_run_step:${stepId}`,
    },
    async () => {
      const policy = loadPolicy(path.join(workspace.workspacePath, "kiwi-policy.yaml"));
      const initiative = loadInitiative(runId, workspace.workspacePath);
      const repoPath = initiative.repoPath || workspace.workspacePath;
      const taskGraph = loadTaskGraph(runId, workspace.workspacePath);
      const step = taskGraph.steps.find((entry) => entry.stepId === stepId);
      if (!step) throw new Error(`Step not found: ${stepId}`);
      assertStepDependenciesCompleted({
        cwd: workspace.workspacePath,
        runId,
        stepId,
        dependsOn: step.dependsOn,
      });

      const decision = scheduleStepAttempt({
        cwd: workspace.workspacePath,
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

      const approval = loadApprovalDecision({ cwd: workspace.workspacePath, runId, attemptId: decision.attemptId });
      const sandbox = createWorktreeSandbox({
        cwd: workspace.workspacePath,
        runId,
        attemptId: decision.attemptId,
        sourcePath: repoPath,
      });
      const profile = commandProfileForStep(policy, step.type);
      const commandPolicy = commandProfileToExecutionPolicy(profile) as SandboxCommandPolicy;
      const command = typeof args.command === "string" ? splitCommandLine(args.command) : noopCommand();
      const result = await new StepAttemptOrchestrator<SandboxCommandPolicy>().execute({
        cwd: workspace.workspacePath,
        repoPath,
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
      const run = refreshRunStatusFromAttempts({ cwd: workspace.workspacePath, runId });
      return {
        attemptId: decision.attemptId,
        status: result.status,
        nextAction: result.nextAction,
        runStatus: run.status,
      };
    },
  );
}

async function runTool(args: Record<string, unknown>, cwd: string): Promise<unknown> {
  const runId = String(args.runId ?? "");
  if (!runId) throw new Error("kiwi_run requires runId");
  const workspace = workspaceArgs(args, cwd, false);
  const taskGraph = loadTaskGraph(runId, workspace.workspacePath);
  const fromStep = typeof args.fromStep === "string" ? args.fromStep : undefined;
  const startIndex = fromStep
    ? taskGraph.steps.findIndex((step) => step.stepId === fromStep)
    : 0;
  if (startIndex < 0) throw new Error(`Step not found: ${fromStep}`);

  const steps: unknown[] = [];
  for (const step of taskGraph.steps.slice(startIndex)) {
    steps.push(
      await runStepTool(
        {
          ...args,
          workspacePath: workspace.workspacePath,
          runId,
          stepId: step.stepId,
        },
        cwd,
      ),
    );
    const status = getRunStatusSummary(workspace.workspacePath, runId).latest[0]?.status;
    if (status === "failed" || status === "needs_approval") break;
  }
  const run = getRunStatusSummary(workspace.workspacePath, runId).latest[0];
  return {
    runId,
    status: run?.status ?? "missing",
    steps,
  };
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
  const workspace = workspaceArgs(args, cwd, false);
  switch (name) {
    case "kiwi_plan":
      return planTool(args, cwd);
    case "kiwi_status":
      return getRunStatusSummary(workspace.workspacePath, typeof args.runId === "string" ? args.runId : undefined);
    case "kiwi_run":
      return runTool(args, cwd);
    case "kiwi_run_step":
      return runStepTool(args, cwd);
    case "kiwi_finalize":
      return withRunLock(
        { cwd: workspace.workspacePath, runId: String(args.runId ?? ""), operation: "mcp_finalize" },
        () => finalizeRun({ cwd: workspace.workspacePath, runId: String(args.runId ?? "") }),
      );
    case "kiwi_request_approval":
      return withRunLock(
        {
          cwd: workspace.workspacePath,
          runId: String(args.runId ?? ""),
          operation: `mcp_approval:${String(args.attemptId ?? "")}`,
        },
        () =>
          recordApprovalDecision({
            cwd: workspace.workspacePath,
            runId: String(args.runId ?? ""),
            attemptId: String(args.attemptId ?? ""),
            reason: String(args.reason ?? "Approved through MCP"),
            approvedBy: String(args.approvedBy ?? "mcp-operator"),
          }),
      );
    case "kiwi_evidence_manifest":
      return withRunLock(
        { cwd: workspace.workspacePath, runId: String(args.runId ?? ""), operation: "mcp_evidence_manifest" },
        () => writeEvidenceManifest({ cwd: workspace.workspacePath, runId: String(args.runId ?? "") }),
      );
    case "kiwi_operator_snapshot":
      return withRunLock(
        { cwd: workspace.workspacePath, runId: String(args.runId ?? ""), operation: "mcp_operator_snapshot" },
        () => writeOperatorSnapshot({ cwd: workspace.workspacePath, runId: String(args.runId ?? "") }),
      );
    case "kiwi_a2a_receive":
      return handleA2AEnvelope({
        cwd: workspace.workspacePath,
        envelope: args.envelope,
        policy: {
          mode: args.loopback === true ? "loopback" : "disabled",
          localAgentId: typeof args.localAgentId === "string" ? args.localAgentId : "kiwi-local",
          trustedAgentIds: Array.isArray(args.trustedAgentIds)
            ? args.trustedAgentIds.filter((entry): entry is string => typeof entry === "string")
            : [],
        },
      }).decision;
    case "kiwi_a2a_config": {
      if (typeof args.enabled === "boolean" || typeof args.localAgentId === "string") {
        const configParams: Parameters<typeof setA2AEnabled>[0] = {
          cwd: workspace.workspacePath,
          enabled: typeof args.enabled === "boolean" ? args.enabled : loadA2AConfig(workspace.workspacePath).enabled,
        };
        if (typeof args.localAgentId === "string") configParams.localAgentId = args.localAgentId;
        return setA2AEnabled(configParams);
      }
      return loadA2AConfig(workspace.workspacePath);
    }
    case "kiwi_a2a_trust_add":
      return addA2ATrustedPeer({
        cwd: workspace.workspacePath,
        agentId: String(args.agentId ?? ""),
        inboxPath: String(args.inboxPath ?? ""),
        allowRemotePatches: args.allowRemotePatches === true,
      });
    case "kiwi_a2a_trust_list":
      return loadA2AConfig(workspace.workspacePath).peers;
    case "kiwi_a2a_trust_remove":
      return removeA2ATrustedPeer({
        cwd: workspace.workspacePath,
        agentId: String(args.agentId ?? ""),
      });
    case "kiwi_a2a_publish":
    {
      const publishParams: Parameters<typeof publishA2AEnvelope>[0] = {
        cwd: workspace.workspacePath,
        peerAgentId: String(args.peerAgentId ?? args.peer ?? ""),
        kind: ProtocolEnvelopeKindSchema.parse(args.kind),
      };
      if (typeof args.runId === "string") publishParams.runId = args.runId;
      if (typeof args.stepId === "string") publishParams.stepId = args.stepId;
      if (typeof args.attemptId === "string") publishParams.attemptId = args.attemptId;
      if (typeof args.gateId === "string") publishParams.gateId = args.gateId;
      if (typeof args.artifactRef === "string") publishParams.artifactRef = args.artifactRef;
      if (typeof args.correlationId === "string") publishParams.correlationId = args.correlationId;
      if (typeof args.idempotencyKey === "string") publishParams.idempotencyKey = args.idempotencyKey;
      if (args.payload !== undefined) publishParams.payload = args.payload;
      return publishA2AEnvelope(publishParams);
    }
    case "kiwi_a2a_sync":
      return syncA2AFilesystem({ cwd: workspace.workspacePath });
    case "kiwi_a2a_inbox":
      return listA2AInbox({ cwd: workspace.workspacePath, includeQuarantine: true });
    case "kiwi_a2a_accept": {
      const acceptWorkspace = workspaceArgs(args, cwd, true);
      const repo = acceptWorkspace.repo!;
      return acceptA2AHandoff({
        cwd: acceptWorkspace.workspacePath,
        messageId: String(args.messageId ?? ""),
        workspacePath: acceptWorkspace.workspacePath,
        repoId: repo.id,
        repoPath: repo.path,
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const RUN_ID_SCHEMA = {
  type: "object",
  properties: {
    runId: { type: "string" },
    workspacePath: { type: "string" },
    repoId: { type: "string" },
    repoPath: { type: "string" },
  },
  required: ["runId"],
} as const;

const NO_AUTO_COMMIT_NOTE = "Do not stage, commit, tag, or push unless the user explicitly requested that git operation.";

const TOOLS = [
  {
    name: "kiwi_plan",
    description: `Create a planned kiwi run. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        ticket: { type: "string" },
        rawInput: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
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
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "kiwi_run",
    description: `Execute planned steps in order. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        fromStep: { type: "string" },
        command: { type: "string" },
        approved: { type: "boolean" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["runId"],
    },
  },
  {
    name: "kiwi_run_step",
    description: `Execute a planned step through policy gates. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        stepId: { type: "string" },
        command: { type: "string" },
        approved: { type: "boolean" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["runId", "stepId"],
    },
  },
  { name: "kiwi_finalize", description: `Finalize a run. ${NO_AUTO_COMMIT_NOTE}`, inputSchema: RUN_ID_SCHEMA },
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
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
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
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["envelope"],
    },
  },
  {
    name: "kiwi_a2a_config",
    description: "Read or update filesystem A2A config",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        localAgentId: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "kiwi_a2a_trust_add",
    description: "Trust an A2A filesystem peer",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        inboxPath: { type: "string" },
        allowRemotePatches: { type: "boolean" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["agentId", "inboxPath"],
    },
  },
  {
    name: "kiwi_a2a_trust_list",
    description: "List trusted A2A filesystem peers",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "kiwi_a2a_trust_remove",
    description: "Remove a trusted A2A filesystem peer",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["agentId"],
    },
  },
  {
    name: "kiwi_a2a_publish",
    description: "Queue a canonical A2A envelope for a trusted peer",
    inputSchema: {
      type: "object",
      properties: {
        peerAgentId: { type: "string" },
        kind: {
          type: "string",
          enum: ["initiative", "task_graph", "step_attempt", "gate_result", "review_verdict", "artifact"],
        },
        runId: { type: "string" },
        stepId: { type: "string" },
        attemptId: { type: "string" },
        gateId: { type: "string" },
        artifactRef: { type: "string" },
        correlationId: { type: "string" },
        idempotencyKey: { type: "string" },
        payload: { type: "object" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["peerAgentId", "kind"],
    },
  },
  {
    name: "kiwi_a2a_sync",
    description: "Deliver queued A2A envelopes and import incoming filesystem envelopes",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "kiwi_a2a_inbox",
    description: "List accepted and quarantined A2A inbox items",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "kiwi_a2a_accept",
    description: "Materialize an incoming A2A initiative handoff as a local run",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["messageId"],
    },
  },
] as const;

function defaultServerCwd(): string {
  return process.env.KIWI_WORKSPACE ?? process.cwd();
}

export async function handleMcpRequest(
  request: JsonRpcRequest,
  cwd: string = defaultServerCwd(),
): Promise<JsonRpcResponse> {
  const id = request.id ?? null;
  try {
    if (request.method === "initialize") {
      const params = asRecord(request.params);
      const protocolVersion = typeof params.protocolVersion === "string"
        ? params.protocolVersion
        : "2024-11-05";
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          serverInfo: { name: "kiwi", version: "0.1.0" },
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

function encodeStdioMessage(payload: unknown): string {
  return `${JSON.stringify(payload)}\n`;
}

function debugLog(message: string, details: Record<string, unknown> = {}): void {
  const target = process.env.KIWI_MCP_DEBUG_LOG;
  if (!target) return;
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify({
    ts: new Date().toISOString(),
    message,
    ...details,
  })}\n`, "utf-8");
}

function findHeaderSeparator(buffer: Buffer): { index: number; length: number } | null {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf < 0 && lf < 0) return null;
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function startsWithContentLength(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 32)).toString("ascii").toLowerCase().startsWith("content-length:");
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return typeof value === "object"
    && value !== null
    && typeof (value as { method?: unknown }).method === "string";
}

async function handleMcpMessage(value: unknown, cwd: string): Promise<unknown | undefined> {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid request" },
      };
    }

    const responses: JsonRpcResponse[] = [];
    for (const entry of value) {
      if (!isJsonRpcRequest(entry) || entry.id === undefined) continue;
      responses.push(await handleMcpRequest(entry, cwd));
    }
    return responses.length > 0 ? responses : undefined;
  }

  if (!isJsonRpcRequest(value)) return undefined;
  if (value.id === undefined) return undefined;
  return handleMcpRequest(value, cwd);
}

async function handleParsedMcpMessage(
  value: unknown,
  cwd: string,
  writeResponse: (payload: unknown) => void,
): Promise<void> {
  const response = await handleMcpMessage(value, cwd);
  if (response !== undefined) writeResponse(response);
}

export function createMcpMessageDrainer(
  cwd: string,
  writeResponse: (payload: unknown) => void,
): (chunk: Buffer) => Promise<void> {
  let buffer = Buffer.alloc(0);

  return async function drainMessages(chunk: Buffer): Promise<void> {
    buffer = Buffer.concat([buffer, chunk]);
    debugLog("stdio_chunk", { bytes: chunk.length, bufferedBytes: buffer.length });

    while (true) {
      let body: string | null = null;

      if (startsWithContentLength(buffer)) {
        const separator = findHeaderSeparator(buffer);
        if (!separator) return;

        const header = buffer.subarray(0, separator.index).toString("ascii");
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match?.[1]) return;

        const length = Number(match[1]);
        const start = separator.index + separator.length;
        const end = start + length;
        if (buffer.length < end) return;

        body = buffer.subarray(start, end).toString("utf-8");
        buffer = buffer.subarray(end);
      } else {
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;

        body = buffer.subarray(0, newline).toString("utf-8").replace(/\r$/, "");
        buffer = buffer.subarray(newline + 1);
        if (body.length === 0) continue;
      }

      let message: unknown;
      try {
        message = JSON.parse(body) as unknown;
      } catch {
        debugLog("parse_error", { bytes: body.length });
        writeResponse({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
        continue;
      }

      debugLog("message", { batch: Array.isArray(message) });
      await handleParsedMcpMessage(message, cwd, writeResponse);
    }
  };
}

export interface HttpMcpServerOptions {
  cwd?: string;
  host?: string;
  port?: number;
  path?: string;
  allowedOrigins?: string[];
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid HTTP port: ${value}`);
  }
  return port;
}

function allowedOriginsFromEnv(): string[] {
  return (process.env.KIWI_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  } catch {
    return false;
  }
}

function applyCorsHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: string[],
): void {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !isAllowedOrigin(origin, allowedOrigins)) return;

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "content-type, accept, mcp-session-id");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body, "utf-8"),
  });
  response.end(body);
}

function readRequestBody(request: IncomingMessage, maxBytes = 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    request.on("data", (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf-8");
      totalBytes += data.length;
      if (totalBytes > maxBytes) {
        reject(new Error("MCP HTTP request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(data);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function handleHttpMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  params: {
    cwd: string;
    endpointPath: string;
    allowedOrigins: string[];
  },
): Promise<void> {
  const { cwd, endpointPath, allowedOrigins } = params;
  applyCorsHeaders(request, response, allowedOrigins);

  if (!isAllowedOrigin(typeof request.headers.origin === "string" ? request.headers.origin : undefined, allowedOrigins)) {
    response.writeHead(403);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== endpointPath) {
    response.writeHead(404);
    response.end();
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET") {
    response.writeHead(405, { allow: "POST, GET, OPTIONS" });
    response.end();
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST, GET, OPTIONS" });
    response.end();
    return;
  }

  let message: unknown;
  try {
    message = JSON.parse((await readRequestBody(request)).toString("utf-8")) as unknown;
  } catch (error) {
    const parseMessage = error instanceof SyntaxError ? "Parse error" : error instanceof Error ? error.message : "Parse error";
    sendJson(response, 400, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: parseMessage },
    });
    return;
  }

  const payload = await handleMcpMessage(message, cwd);
  if (payload === undefined) {
    response.writeHead(202);
    response.end();
    return;
  }

  sendJson(response, 200, payload);
}

export function startHttpMcpServer(options: HttpMcpServerOptions = {}): Server {
  const cwd = options.cwd ?? defaultServerCwd();
  const host = options.host ?? process.env.KIWI_MCP_HTTP_HOST ?? "127.0.0.1";
  const port = options.port ?? parsePort(process.env.KIWI_MCP_HTTP_PORT, 3333);
  const endpointPath = options.path ?? process.env.KIWI_MCP_HTTP_PATH ?? "/mcp";
  const allowedOrigins = options.allowedOrigins ?? allowedOriginsFromEnv();

  const server = createServer((request, response) => {
    void handleHttpMcpRequest(request, response, { cwd, endpointPath, allowedOrigins }).catch((error) => {
      debugLog("http_error", { error: error instanceof Error ? error.stack || error.message : String(error) });
      if (!response.headersSent) {
        sendJson(response, 500, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: "Internal server error" },
        });
        return;
      }
      response.end();
    });
  });

  server.listen(port, host, () => {
    debugLog("http_server_start", { cwd, host, port, endpointPath });
  });
  return server;
}

export function startMcpServer(cwd: string = defaultServerCwd()): void {
  debugLog("server_start", { cwd, pid: process.pid });
  const drainMessages = createMcpMessageDrainer(cwd, (payload) => {
    process.stdout.write(encodeStdioMessage(payload));
  });
  let drain = Promise.resolve();

  process.stdin.on("data", (chunk) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf-8");
    drain = drain.then(() => drainMessages(data), () => drainMessages(data));
  });
}

function cliOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

if (require.main === module) {
  const cwd = cliOption("--workspace") ?? defaultServerCwd();
  const transport = cliOption("--transport") ?? process.env.KIWI_MCP_TRANSPORT ?? "stdio";
  if (transport === "http" || transport === "streamable-http") {
    const options: HttpMcpServerOptions = { cwd };
    const host = cliOption("--host");
    const port = cliOption("--port");
    const endpointPath = cliOption("--path");
    if (host) options.host = host;
    if (port) options.port = parsePort(port, 3333);
    if (endpointPath) options.path = endpointPath;
    startHttpMcpServer(options);
  } else {
    startMcpServer(cwd);
  }
}
