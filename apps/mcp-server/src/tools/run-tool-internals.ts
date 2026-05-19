import { ContractValues, ProgressStatuses, RiskProfiles, RunStatuses, type TaskGraph } from "@kiwi/contracts";
import { buildRunCompletionSummary } from "@kiwi/ops";
import {
  assertDirectExecutionSafe,
  DirectExecutionUnsafeError,
  type RunExecutionPreview,
  runScheduledSubPlans,
  splitCommandLine,
} from "@kiwi/runtime";
import { withOperatorCard } from "../ux/operator-card.js";
import { consumeMcpPreviewToken, normalizePreviewInput, validateMcpPreviewToken } from "./preview-tokens.js";
import { runStepToolUnlocked, type RunStepToolResult } from "./run-step-execution.js";
import { ToolActionRequiredError } from "./errors.js";
import { progressLine, type ToolCallOptions } from "./helpers.js";
import { mutationScope, safeReadOnlyToolCalls, toolCall, type McpNextAction, workspaceToolArgs } from "../ux/index.js";
import { getMcpServerServices } from "../services.js";

const MCP_COMMAND_OVERRIDE_ENV = "KIWI_ALLOW_MCP_COMMAND_OVERRIDE";

const commandOverride = {
  envName(): string {
    return MCP_COMMAND_OVERRIDE_ENV;
  },
  enabled(): boolean {
    return process.env[commandOverride.envName()] === "1";
  },
};

function services(): ReturnType<typeof getMcpServerServices> {
  return getMcpServerServices();
}

export function nextRunAction(params: {
  workspacePath: string;
  repoId?: string | null | undefined;
  repoPath?: string | null | undefined;
  runId: string;
  previewToken: string;
  fromStep?: string | undefined;
  maxConcurrency?: number | undefined;
  command?: string | undefined;
  maxConcurrencyExplicit?: boolean | undefined;
}): McpNextAction {
  return {
    recommendedToolCall: toolCall("kiwi_run", {
      ...workspaceToolArgs(params),
      previewToken: params.previewToken,
      ...(params.fromStep ? { fromStep: params.fromStep } : {}),
      ...(params.maxConcurrencyExplicit === true && params.maxConcurrency !== undefined
        ? { maxConcurrency: params.maxConcurrency }
        : {}),
      ...(params.command ? { command: params.command } : {}),
    }),
    whyThisTool: "The previewToken is fresh for this run, repo state, policy, and execution options.",
    requiresUserConfirmation: true,
    expectedMutation: "MUTATES_WORKTREE",
    expectedAfter: "Run execution starts and progress notifications describe routing, gates, review, and final state.",
  };
}

export function blockedPreviewAction(params: {
  workspacePath: string;
  repoId?: string | null | undefined;
  repoPath?: string | null | undefined;
  runId: string;
  blockedSteps: RunExecutionPreview["steps"];
  fromStep?: string | undefined;
  maxConcurrency?: number | undefined;
  command?: string | undefined;
  maxConcurrencyExplicit?: boolean | undefined;
}): McpNextAction {
  const blockedSummary = params.blockedSteps
    .map((step) => `${step.stepId}${step.blockedReason ? `:${step.blockedReason}` : ""}`)
    .join(",");

  return {
    recommendedToolCall: toolCall("kiwi_preview_run", {
      ...workspaceToolArgs(params),
      ...(params.fromStep ? { fromStep: params.fromStep } : {}),
      ...(params.maxConcurrencyExplicit === true && params.maxConcurrency !== undefined
        ? { maxConcurrency: params.maxConcurrency }
        : {}),
      ...(params.command ? { command: params.command } : {}),
    }),
    whyThisTool: `Execution is blocked by previewed step(s): ${blockedSummary}.`,
    requiresUserConfirmation: false,
    expectedMutation: "WRITES_RUN_ARTIFACTS",
    expectedAfter: "Inspect the blocked preview decision, fix routing/budget/runner availability, then preview again.",
  };
}

export function assertMcpDirectExecutionSafe(params: {
  workspacePath: string;
  repoPath: string | null;
  runId: string;
}): void {
  if (!params.repoPath) {
    return;
  }
  try {
    assertDirectExecutionSafe(params.repoPath);
  } catch (error) {
    if (!(error instanceof DirectExecutionUnsafeError)) {
      throw error;
    }
    throw new ToolActionRequiredError(error.message, {
      category: "action_required",
      recovery: {
        reason: error.reasons.join("; "),
        recommendedToolCall: toolCall("kiwi_doctor", {
          workspacePath: params.workspacePath,
          repoPath: params.repoPath,
        }),
        safeAlternatives: safeReadOnlyToolCalls({
          workspacePath: params.workspacePath,
          repoPath: params.repoPath,
          runId: params.runId,
        }),
        userMessage:
          "Direct execution is unsafe. Switch away from main/master, clean the repo, or use worktree isolation.",
      },
    });
  }
}

export function assertMcpCommandOverrideAllowed(params: {
  args: Record<string, unknown>;
  workspacePath: string;
  runId: string;
}): void {
  if (typeof params.args.command !== "string") {
    return;
  }
  const initiative = services().core.runs.loadInitiative(params.runId, params.workspacePath);

  if (initiative.riskProfile === RiskProfiles.Dev || commandOverride.enabled()) {
    return;
  }

  throw new ToolActionRequiredError("MCP command override requires a dev-risk run or explicit server opt-in", {
    category: "action_required",
    recovery: {
      reason: `run riskProfile is ${initiative.riskProfile}; command overrides require explicit server opt-in`,
      recommendedToolCall: toolCall("kiwi_next", {
        workspacePath: params.workspacePath,
        runId: params.runId,
      }),
      safeAlternatives: safeReadOnlyToolCalls({
        workspacePath: params.workspacePath,
        runId: params.runId,
      }),
      userMessage:
        "Retry without command, use a dev-risk run, or start the MCP server with KIWI_ALLOW_MCP_COMMAND_OVERRIDE=1.",
    },
  });
}

export function previewStepViews(preview: RunExecutionPreview): Array<Record<string, unknown>> {
  return preview.steps.map((step, index) => ({
    index: index + 1,
    count: preview.steps.length,
    stepId: step.stepId,
    title: step.title,
    type: step.type,
    status: step.status,
    blockedReason: step.blockedReason ?? null,
    agentRole: step.agentRole,
    modelCapability: step.modelCapability,
    runner: step.runner,
    selectedModelId: step.selectedModelId,
    selectedProviderModel: step.selectedProviderModel,
    selectedAccessMode: step.selectedAccessMode,
    executorSelectionReason: step.executorSelectionReason,
    estimatedAttemptCostUsd: step.estimatedAttemptCostUsd,
    requiredGates: step.requiredGates,
    routingReason: step.routingReason,
    reviewDepth: step.reviewDepth,
    contextLevel: step.contextLevel,
  }));
}

function buildPreviewFromRecord(params: {
  workspacePath: string;
  runId: string;
  previewInput: ReturnType<typeof normalizePreviewInput>;
}): RunExecutionPreview {
  return services().runtime.execution.previews.build({
    cwd: params.workspacePath,
    runId: params.runId,
    ...(params.previewInput.fromStep ? { fromStep: params.previewInput.fromStep } : {}),
    ...(params.previewInput.maxConcurrencyExplicit === true
      ? { maxConcurrency: params.previewInput.maxConcurrency }
      : {}),
    ...(params.previewInput.command ? { command: splitCommandLine(params.previewInput.command) } : {}),
  });
}

type PreviewTokenRecord = ReturnType<typeof validateMcpPreviewToken>;
type PreviewStepById = Map<string, RunExecutionPreview["steps"][number]>;

interface RunToolLockedContext {
  args: Record<string, unknown>;
  workspacePath: string;
  repoPath: string | null;
  runId: string;
  fromStep?: string | undefined;
  maxConcurrency?: number | undefined;
  callOptions: ToolCallOptions;
}

interface RunToolExecutionContext extends RunToolLockedContext {
  previewRecord: PreviewTokenRecord;
  taskGraph: TaskGraph;
  previewStepsById: PreviewStepById;
  steps: RunStepToolResult[];
}

function validateRunToolPreview(context: RunToolLockedContext): PreviewTokenRecord {
  const previewRecord = validateMcpPreviewToken({
    cwd: context.workspacePath,
    runId: context.runId,
    previewToken: typeof context.args.previewToken === "string" ? context.args.previewToken : undefined,
    previewInput: normalizePreviewInput({
      fromStep: context.fromStep,
      maxConcurrency: context.maxConcurrency,
      command: typeof context.args.command === "string" ? context.args.command : undefined,
    }),
  });

  if (previewRecord.executionIsolation === "direct") {
    assertMcpDirectExecutionSafe({
      workspacePath: context.workspacePath,
      repoPath: previewRecord.repoPath,
      runId: context.runId,
    });
  }
  assertMcpCommandOverrideAllowed({
    args: context.args,
    workspacePath: context.workspacePath,
    runId: context.runId,
  });

  return previewRecord;
}

function findStartIndex(params: { taskGraph: TaskGraph; fromStep?: string | undefined }): number {
  return params.fromStep ? params.taskGraph.steps.findIndex((step) => step.stepId === params.fromStep) : 0;
}

function previewStepIndex(record: PreviewTokenRecord, stepId: string): number | undefined {
  const index = record.previewStepIds.indexOf(stepId);

  return index >= 0 ? index + 1 : undefined;
}

function throwStalePreviewStep(context: RunToolLockedContext): never {
  throw new ToolActionRequiredError(`Stale previewToken: step not found: ${context.fromStep}`, {
    category: "stale_preview",
    recovery: {
      reason: `step ${context.fromStep} is not in the current TaskGraph`,
      recommendedToolCall: toolCall("kiwi_preview_run", {
        workspacePath: context.workspacePath,
        runId: context.runId,
      }),
      safeAlternatives: safeReadOnlyToolCalls({ workspacePath: context.workspacePath, runId: context.runId }),
      userMessage: "The run changed since preview. Create and confirm a fresh preview before running.",
    },
  });
}

async function runScheduledPreviewSteps(context: RunToolExecutionContext): Promise<void> {
  await runScheduledSubPlans<{ command?: string }>({
    cwd: context.workspacePath,
    runId: context.runId,
    ...(context.fromStep ? { fromStep: context.fromStep } : {}),
    ...(context.maxConcurrency !== undefined ? { maxGlobalConcurrency: context.maxConcurrency } : {}),
    attemptOptions: {
      ...(typeof context.args.command === "string" ? { command: context.args.command } : {}),
    },
    runStep: async (_scheduledRunId, stepId, attemptOptions) => {
      const progressContext: {
        stepIndex?: number;
        stepCount: number;
        previewStep: RunExecutionPreview["steps"][number] | null;
      } = {
        stepCount: context.previewRecord.previewStepIds.length,
        previewStep: context.previewStepsById.get(stepId) ?? null,
      };
      const stepIndex = previewStepIndex(context.previewRecord, stepId);

      if (stepIndex !== undefined) {
        progressContext.stepIndex = stepIndex;
      }
      context.steps.push(
        await runStepToolUnlocked(
          {
            ...context.args,
            workspacePath: context.workspacePath,
            runId: context.runId,
            stepId,
          },
          context.workspacePath,
          context.callOptions,
          progressContext,
          attemptOptions,
        ),
      );
    },
  });
}

async function runSequentialPreviewSteps(context: RunToolExecutionContext, startIndex: number): Promise<void> {
  const selectedSteps = context.taskGraph.steps.slice(startIndex);

  for (const [index, step] of selectedSteps.entries()) {
    context.steps.push(
      await runStepToolUnlocked(
        {
          ...context.args,
          workspacePath: context.workspacePath,
          runId: context.runId,
          stepId: step.stepId,
        },
        context.workspacePath,
        context.callOptions,
        {
          stepIndex: index + 1,
          stepCount: selectedSteps.length,
          previewStep: context.previewStepsById.get(step.stepId) ?? null,
        },
      ),
    );
    const status = services().core.runStatus.summary(context.workspacePath, context.runId).latest[0]?.currentStatus;

    if (status === ContractValues.Failed || status === RunStatuses.NeedsApproval) {
      break;
    }
  }
}

async function runPreviewSteps(context: RunToolExecutionContext, startIndex: number): Promise<void> {
  if (context.taskGraph.subPlans && context.taskGraph.subPlans.length > 1) {
    await runScheduledPreviewSteps(context);

    return;
  }
  await runSequentialPreviewSteps(context, startIndex);
}

function runExecutionResult(context: RunToolExecutionContext): unknown {
  const run = services().core.runStatus.summary(context.workspacePath, context.runId).latest[0];
  const order = new Map(context.previewRecord.previewStepIds.map((stepId, index) => [stepId, index]));
  const steps = [...context.steps].sort(
    (left, right) =>
      (order.get(left.stepId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.stepId) ?? Number.MAX_SAFE_INTEGER),
  );

  context.callOptions.onProgress?.(
    progressLine({ phase: "run", status: run?.currentStatus ?? "missing", runId: context.runId }),
    100,
  );

  return withOperatorCard(
    {
      schemaVersion: "2",
      kind: "run_execution_result",
      runId: context.runId,
      status: run?.currentStatus ?? "missing",
      steps,
      summary: buildRunCompletionSummary({ cwd: context.workspacePath, runId: context.runId }),
    },
    {
      cwd: context.workspacePath,
      runId: context.runId,
      lastAction: "kiwi_run",
      mutationScope: mutationScope({
        riskLabel: "MUTATES_WORKTREE",
        workspacePath: context.workspacePath,
        repoPath: context.repoPath,
        executionMode: null,
      }),
    },
  );
}

export async function executeRunToolLocked(context: RunToolLockedContext): Promise<unknown> {
  const previewRecord = validateRunToolPreview(context);
  const taskGraph = services().core.runs.loadTaskGraph(context.runId, context.workspacePath);
  const preview = buildPreviewFromRecord({
    workspacePath: context.workspacePath,
    runId: context.runId,
    previewInput: previewRecord.previewInput,
  });
  const executionContext: RunToolExecutionContext = {
    ...context,
    previewRecord,
    taskGraph,
    previewStepsById: new Map(preview.steps.map((step) => [step.stepId, step])),
    steps: [],
  };

  context.callOptions.onProgress?.(
    progressLine({ phase: "run", status: ProgressStatuses.Started, runId: context.runId }),
    0,
  );
  const startIndex = findStartIndex({ taskGraph, fromStep: context.fromStep });

  if (startIndex < 0) {
    throwStalePreviewStep(context);
  }
  consumeMcpPreviewToken({
    cwd: context.workspacePath,
    runId: context.runId,
    record: previewRecord,
  });
  await runPreviewSteps(executionContext, startIndex);

  return runExecutionResult(executionContext);
}

export function previewFromRecord(params: {
  workspacePath: string;
  runId: string;
  previewInput: ReturnType<typeof normalizePreviewInput>;
}): RunExecutionPreview {
  return buildPreviewFromRecord(params);
}
