import { runPlannerProviderWithRetries } from "@kiwi/adapters";
import { ContractValues, ProtocolEnvelopeKindSchema } from "@kiwi/contracts";
import {
  acceptA2AHandoff,
  addA2ATrustedPeer,
  handleA2AEnvelope,
  listA2AInbox,
  loadA2AConfig,
  publishA2AEnvelope,
  removeA2ATrustedPeer,
  setA2AEnabled,
  syncA2AFilesystem,
} from "@kiwi/a2a";
import {
  executePlannedStep,
  finalizeRun,
  resolvePlannerProvider,
  runScheduledSubPlans,
  splitCommandLine,
} from "@kiwi/runtime";
import {
  buildRunCompletionSummary,
  buildRunExplanation,
  writeEvidenceManifest,
  writeOperatorSnapshot,
} from "@kiwi/ops";
import {
  getRunStatusSummary,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  loadPolicy,
  loadRegistry,
  loadTaskGraph,
  planRun,
  recordApprovalDecision,
  withRunLock,
} from "@kiwi/core";
import { publishPrDraftTool } from "./publish-tool";
import { validateToolArguments } from "./tool-input-schemas";
import { workspaceArgs } from "./workspace";

export function toolArguments(params: Record<string, unknown>): Record<string, unknown> {
  const rawArguments = params.arguments;
  if (typeof rawArguments === "object" && rawArguments !== null && !Array.isArray(rawArguments)) {
    return rawArguments as Record<string, unknown>;
  }
  if (typeof rawArguments === "string") {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("tools/call arguments JSON string must decode to an object");
  }

  const fallback: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "name" || key === "arguments") continue;
    fallback[key] = value;
  }
  return fallback;
}

async function planTool(args: Record<string, unknown>, cwd: string): Promise<unknown> {
  const rawInput = String(args.ticket ?? args.rawInput ?? "");
  if (!rawInput) {
    throw new Error(
      `kiwi_plan requires ticket or rawInput; received argument keys: ${Object.keys(args).sort().join(", ") || "(none)"}`,
    );
  }
  const workspace = workspaceArgs(args, cwd, true);
  const repo = workspace.repo!;
  const now = new Date();
  const policyPath = kiwiPolicyPath(workspace.workspacePath);
  const policy = loadPolicy(policyPath);
  const registry = loadRegistry(kiwiModelRegistryPath(workspace.workspacePath));
  const resolution = resolvePlannerProvider({
    registryModels: registry.models,
    now: () => now,
    ...(args.allowStub === true ? { allowStub: true } : {}),
  });
  const planned = await planRun({
    workspacePath: workspace.workspacePath,
    repoId: repo.id,
    repoPath: repo.path,
    rawInput,
    source: "mcp",
    policy,
    plannerModel: resolution.model,
    executePlanner: (plannerInput, options) =>
      runPlannerProviderWithRetries(resolution.provider, plannerInput, options),
    riskProfile: args.riskProfile === "production" ? "production" : "dev",
    budgetProfile: args.budgetProfile === "tiny" ? "tiny" : "normal",
    now,
  });
  return {
    runId: planned.runId,
    planId: planned.taskGraph.planId,
    steps: planned.taskGraph.steps.length,
    workspacePath: planned.workspacePath,
    repoId: planned.repoId,
    repoPath: planned.repoPath,
  };
}

interface RunStepToolResult {
  attemptId: string;
  status: string;
  nextAction: unknown;
  runStatus: string;
}

function parseMaxConcurrency(args: Record<string, unknown>): number | undefined {
  if (typeof args.maxConcurrency === "number") return args.maxConcurrency;
  if (typeof args.maxConcurrency !== "string" || args.maxConcurrency.trim().length === 0) return undefined;
  const parsed = Number.parseInt(args.maxConcurrency, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`kiwi_run maxConcurrency must be a positive integer; received ${args.maxConcurrency}`);
  }
  return parsed;
}

async function runStepToolUnlocked(args: Record<string, unknown>, workspacePath: string): Promise<RunStepToolResult> {
  const runId = String(args.runId ?? "");
  const stepId = String(args.stepId ?? "");
  if (!runId || !stepId) throw new Error("kiwi_run_step requires runId and stepId");
  const input: Parameters<typeof executePlannedStep>[0] = { cwd: workspacePath, runId, stepId };
  if (typeof args.command === "string") input.command = splitCommandLine(args.command);
  if (args.approved === true) input.approved = true;
  if (typeof args.attemptId === "string") input.attemptId = args.attemptId;
  const result = await executePlannedStep(input);
  return {
    attemptId: result.attemptId,
    status: result.status,
    nextAction: result.nextAction,
    runStatus: result.runStatus,
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
    () => runStepToolUnlocked(args, workspace.workspacePath),
  );
}

async function runTool(args: Record<string, unknown>, cwd: string): Promise<unknown> {
  const runId = String(args.runId ?? "");
  if (!runId) throw new Error("kiwi_run requires runId");
  const workspace = workspaceArgs(args, cwd, false);
  const fromStep = typeof args.fromStep === "string" ? args.fromStep : undefined;
  const maxConcurrency = parseMaxConcurrency(args);
  if (maxConcurrency !== undefined && (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0)) {
    throw new Error(`kiwi_run maxConcurrency must be a positive integer; received ${maxConcurrency}`);
  }

  return withRunLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: "mcp_run",
    },
    async () => {
      const taskGraph = loadTaskGraph(runId, workspace.workspacePath);
      const steps: RunStepToolResult[] = [];

      if (taskGraph.subPlans && taskGraph.subPlans.length > 1) {
        await runScheduledSubPlans<{ command?: string; approved?: boolean }>({
          cwd: workspace.workspacePath,
          runId,
          ...(fromStep ? { fromStep } : {}),
          ...(maxConcurrency !== undefined ? { maxGlobalConcurrency: maxConcurrency } : {}),
          attemptOptions: {
            ...(typeof args.command === "string" ? { command: args.command } : {}),
            ...(args.approved === true ? { approved: true } : {}),
          },
          runStep: async (_scheduledRunId, stepId, options) => {
            steps.push(
              await runStepToolUnlocked(
                {
                  ...args,
                  workspacePath: workspace.workspacePath,
                  runId,
                  stepId,
                  ...options,
                },
                workspace.workspacePath,
              ),
            );
          },
        });
      } else {
        const startIndex = fromStep ? taskGraph.steps.findIndex((step) => step.stepId === fromStep) : 0;
        if (startIndex < 0) throw new Error(`Step not found: ${fromStep}`);

        for (const step of taskGraph.steps.slice(startIndex)) {
          steps.push(
            await runStepToolUnlocked(
              {
                ...args,
                workspacePath: workspace.workspacePath,
                runId,
                stepId: step.stepId,
              },
              workspace.workspacePath,
            ),
          );
          const status = getRunStatusSummary(workspace.workspacePath, runId).latest[0]?.status;
          if (status === ContractValues.Failed || status === "needs_approval") break;
        }
      }

      const run = getRunStatusSummary(workspace.workspacePath, runId).latest[0];
      return {
        runId,
        status: run?.status ?? "missing",
        steps,
        completionSummary: buildRunCompletionSummary({ cwd: workspace.workspacePath, runId }),
      };
    },
  );
}

function callCoreTool(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
  workspacePath: string,
): Promise<unknown> | unknown | undefined {
  switch (name) {
    case "kiwi_status":
      return getRunStatusSummary(workspacePath, typeof args.runId === "string" ? args.runId : undefined);
    case "kiwi_run":
      return runTool(args, cwd);
    case "kiwi_run_step":
      return runStepTool(args, cwd);
    case "kiwi_finalize":
      return withRunLock({ cwd: workspacePath, runId: String(args.runId ?? ""), operation: "mcp_finalize" }, () => {
        const runId = String(args.runId ?? "");
        const finalized = finalizeRun({ cwd: workspacePath, runId });
        return {
          ...finalized,
          completionSummary: buildRunCompletionSummary({ cwd: workspacePath, runId }),
        };
      });
    case "kiwi_cost":
      return buildRunCompletionSummary({ cwd: workspacePath, runId: String(args.runId ?? "") });
    case "kiwi_explain":
      return buildRunExplanation({ cwd: workspacePath, runId: String(args.runId ?? "") });
    case "kiwi_request_approval":
      return withRunLock(
        {
          cwd: workspacePath,
          runId: String(args.runId ?? ""),
          operation: `mcp_approval:${String(args.attemptId ?? "")}`,
        },
        () =>
          recordApprovalDecision({
            cwd: workspacePath,
            runId: String(args.runId ?? ""),
            attemptId: String(args.attemptId ?? ""),
            reason: String(args.reason ?? "Approved through MCP"),
            approvedBy: String(args.approvedBy ?? "mcp-operator"),
          }),
      );
    case "kiwi_evidence_manifest":
      return withRunLock(
        { cwd: workspacePath, runId: String(args.runId ?? ""), operation: "mcp_evidence_manifest" },
        () => writeEvidenceManifest({ cwd: workspacePath, runId: String(args.runId ?? "") }),
      );
    case "kiwi_operator_snapshot":
      return withRunLock(
        { cwd: workspacePath, runId: String(args.runId ?? ""), operation: "mcp_operator_snapshot" },
        () => writeOperatorSnapshot({ cwd: workspacePath, runId: String(args.runId ?? "") }),
      );
    case "kiwi_publish_pr_draft":
      return publishPrDraftTool(args, workspacePath);
    default:
      return undefined;
  }
}

function a2aConfigTool(args: Record<string, unknown>, workspacePath: string): unknown {
  if (typeof args.enabled === "boolean" || typeof args.localAgentId === "string") {
    const configParams: Parameters<typeof setA2AEnabled>[0] = {
      cwd: workspacePath,
      enabled: typeof args.enabled === "boolean" ? args.enabled : loadA2AConfig(workspacePath).enabled,
    };
    if (typeof args.localAgentId === "string") configParams.localAgentId = args.localAgentId;
    return setA2AEnabled(configParams);
  }
  return loadA2AConfig(workspacePath);
}

function publishA2ATool(args: Record<string, unknown>, workspacePath: string): unknown {
  const publishParams: Parameters<typeof publishA2AEnvelope>[0] = {
    cwd: workspacePath,
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

function callA2ATool(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
  workspacePath: string,
): Promise<unknown> | unknown | undefined {
  switch (name) {
    case "kiwi_a2a_receive":
      return handleA2AEnvelope({
        cwd: workspacePath,
        envelope: args.envelope,
        policy: {
          mode: args.loopback === true ? "loopback" : "disabled",
          localAgentId: typeof args.localAgentId === "string" ? args.localAgentId : "kiwi-local",
          trustedAgentIds: Array.isArray(args.trustedAgentIds)
            ? args.trustedAgentIds.filter((entry): entry is string => typeof entry === "string")
            : [],
        },
      }).decision;
    case "kiwi_a2a_config":
      return a2aConfigTool(args, workspacePath);
    case "kiwi_a2a_trust_add":
      return addA2ATrustedPeer({
        cwd: workspacePath,
        agentId: String(args.agentId ?? ""),
        inboxPath: String(args.inboxPath ?? ""),
        allowRemotePatches: args.allowRemotePatches === true,
      });
    case "kiwi_a2a_trust_list":
      return loadA2AConfig(workspacePath).peers;
    case "kiwi_a2a_trust_remove":
      return removeA2ATrustedPeer({
        cwd: workspacePath,
        agentId: String(args.agentId ?? ""),
      });
    case "kiwi_a2a_publish":
      return publishA2ATool(args, workspacePath);
    case "kiwi_a2a_sync":
      return syncA2AFilesystem({ cwd: workspacePath });
    case "kiwi_a2a_inbox":
      return listA2AInbox({ cwd: workspacePath, includeQuarantine: true });
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
      return undefined;
  }
}

export async function callTool(name: string, args: Record<string, unknown>, cwd: string): Promise<unknown> {
  const validatedArgs = validateToolArguments(name, args);
  if (name === "kiwi_plan") return planTool(validatedArgs, cwd);
  const workspace = workspaceArgs(validatedArgs, cwd, false);
  const workspacePath = workspace.workspacePath;
  const coreResult = callCoreTool(name, validatedArgs, cwd, workspacePath);
  if (coreResult !== undefined) return coreResult;
  const a2aResult = callA2ATool(name, validatedArgs, cwd, workspacePath);
  if (a2aResult !== undefined) return a2aResult;
  throw new Error(`Unknown tool: ${name}`);
}
