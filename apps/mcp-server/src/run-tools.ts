import { ContractValues, ProgressStatuses, RiskProfiles, RunStatuses, type TaskGraph } from "@kiwi/contracts";
import { buildRunCompletionSummary } from "@kiwi/ops";
import {
  assertDirectExecutionSafe,
  DirectExecutionUnsafeError,
  type RunExecutionPreview,
  runScheduledSubPlans,
} from "@kiwi/runtime";
import { withOperatorCard } from "./operator-card";
import {
  consumeMcpPreviewToken,
  createMcpPreviewToken,
  normalizePreviewInput,
  validateMcpPreviewToken,
} from "./preview-tokens";
import { runStepToolUnlocked, type RunStepToolResult } from "./run-step-execution";
import { ToolActionRequiredError } from "./tool-errors";
import { previewConfirmationSummary, progressLine, type ToolCallOptions } from "./tool-helpers";
import { mutationScope, safeReadOnlyToolCalls, toolCall, type McpNextAction, workspaceToolArgs } from "./ux";
import { getMcpServerServices } from "./services";
import { workspaceArgs } from "./workspace";

const MCP_COMMAND_OVERRIDE_ENV = "KIWI_ALLOW_MCP_COMMAND_OVERRIDE";

function services(): ReturnType<typeof getMcpServerServices> {
  return getMcpServerServices();
}

function nextRunAction(params: {
  workspacePath: string;
  repoId?: string | null | undefined;
  repoPath?: string | null | undefined;
  runId: string;
  previewToken: string;
  fromStep?: string | undefined;
  maxConcurrency?: number | undefined;
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
    }),
    whyThisTool: "The previewToken is fresh for this run, repo state, policy, and execution options.",
    requiresUserConfirmation: true,
    expectedMutation: "MUTATES_WORKTREE",
    expectedAfter: "Run execution starts and progress notifications describe routing, gates, review, and final state.",
  };
}

function assertMcpDirectExecutionSafe(params: { workspacePath: string; repoPath: string | null; runId: string }): void {
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

function isMcpCommandOverrideEnabled(): boolean {
  return process.env[MCP_COMMAND_OVERRIDE_ENV] === "1";
}

function assertMcpCommandOverrideAllowed(params: {
  args: Record<string, unknown>;
  workspacePath: string;
  runId: string;
}): void {
  if (typeof params.args.command !== "string") {
    return;
  }
  const initiative = services().core.runs.loadInitiative(params.runId, params.workspacePath);

  if (initiative.riskProfile === RiskProfiles.Dev || isMcpCommandOverrideEnabled()) {
    return;
  }

  throw new ToolActionRequiredError("MCP command override requires a dev-risk run or explicit server opt-in", {
    category: "action_required",
    recovery: {
      reason: `run riskProfile is ${initiative.riskProfile}; command overrides are not bound into preview tokens`,
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

export function previewRunTool(args: Record<string, unknown>, cwd: string): unknown {
  const runId = String(args.runId ?? "");
  const workspace = workspaceArgs(args, cwd, false);
  const fromStep = typeof args.fromStep === "string" ? args.fromStep : undefined;
  const maxConcurrency = args.maxConcurrency as number | undefined;
  const previewInput = normalizePreviewInput({ fromStep, maxConcurrency });
  const preview = services().runtime.execution.previews.build({
    cwd: workspace.workspacePath,
    runId,
    ...(fromStep ? { fromStep } : {}),
    ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
  });

  if (preview.executionIsolation === "direct") {
    const initiative = services().core.runs.loadInitiative(runId, workspace.workspacePath);
    assertMcpDirectExecutionSafe({
      workspacePath: workspace.workspacePath,
      repoPath: initiative.repoPath || workspace.workspacePath,
      runId,
    });
  }
  const token = createMcpPreviewToken({
    cwd: workspace.workspacePath,
    runId,
    preview,
    previewInput,
  });
  const estimatedCostUsd = preview.steps.reduce((sum, step) => sum + step.estimatedAttemptCostUsd, 0);
  const nextAction = nextRunAction({
    workspacePath: workspace.workspacePath,
    repoId: workspace.repo?.id,
    repoPath: workspace.repo?.path,
    runId,
    previewToken: token.token,
    fromStep,
    maxConcurrency: previewInput.maxConcurrency,
    maxConcurrencyExplicit: previewInput.maxConcurrencyExplicit,
  });
  const runScope = mutationScope({
    riskLabel: "MUTATES_WORKTREE",
    workspacePath: workspace.workspacePath,
    repoPath: token.repoPath,
    executionMode: preview.executionIsolation,
  });
  const previewScope = mutationScope({
    riskLabel: "WRITES_RUN_ARTIFACTS",
    workspacePath: workspace.workspacePath,
    repoPath: token.repoPath,
    executionMode: preview.executionIsolation,
  });

  return withOperatorCard(
    {
      schemaVersion: "2",
      kind: "run_execution_preview",
      previewToken: token.token,
      previewResource: `kiwi://runs/${runId}/previews/${token.token}`,
      runId,
      workspace: {
        workspacePath: workspace.workspacePath,
        repoId: workspace.repo?.id ?? null,
        repoPath: token.repoPath,
      },
      decision: {
        requiresUserConfirmation: true,
        confirmationSummary: previewConfirmationSummary({
          stepCount: preview.steps.length,
          repoPath: token.repoPath,
          executionIsolation: preview.executionIsolation,
          estimatedCostUsd,
        }),
        nextAction,
      },
      execution: {
        owner: preview.executionOwner,
        isolation: preview.executionIsolation,
        maxConcurrency: preview.maxConcurrency,
        subPlans: preview.subPlans,
        mutationScope: runScope,
      },
      cost: {
        estimatedCostUsd,
        currency: "USD",
      },
      steps: preview.steps.map((step, index) => ({
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
      })),
      safeAlternatives: safeReadOnlyToolCalls({ workspacePath: workspace.workspacePath, runId }),
    },
    {
      cwd: workspace.workspacePath,
      runId,
      lastAction: "kiwi_preview_run",
      nextAction,
      mutationScope: previewScope,
    },
  );
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

async function executeRunToolLocked(context: RunToolLockedContext): Promise<unknown> {
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

export async function runStepTool(
  args: Record<string, unknown>,
  cwd: string,
  options: ToolCallOptions = {},
): Promise<unknown> {
  const runId = String(args.runId ?? "");
  const stepId = String(args.stepId ?? "");
  const workspace = workspaceArgs(args, cwd, false);

  return services().core.locks.withLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: `mcp_run_step:${stepId}`,
    },
    async () => {
      const previewRecord = validateMcpPreviewToken({
        cwd: workspace.workspacePath,
        runId,
        previewToken: typeof args.previewToken === "string" ? args.previewToken : undefined,
        stepId,
      });

      if (previewRecord.executionIsolation === "direct") {
        assertMcpDirectExecutionSafe({
          workspacePath: workspace.workspacePath,
          repoPath: previewRecord.repoPath,
          runId,
        });
      }
      assertMcpCommandOverrideAllowed({ args, workspacePath: workspace.workspacePath, runId });
      const preview = buildPreviewFromRecord({
        workspacePath: workspace.workspacePath,
        runId,
        previewInput: previewRecord.previewInput,
      });
      const previewStep = preview.steps.find((step) => step.stepId === stepId) ?? null;
      consumeMcpPreviewToken({
        cwd: workspace.workspacePath,
        runId,
        record: previewRecord,
        stepId,
      });
      const result = await runStepToolUnlocked(args, workspace.workspacePath, options, {
        stepIndex: 1,
        stepCount: 1,
        previewStep,
      });

      return withOperatorCard(
        {
          schemaVersion: "2",
          kind: "step_execution_result",
          runId,
          stepId,
          attempt: {
            attemptId: result.attemptId,
            status: result.status,
            nextAction: result.nextAction,
          },
          runStatus: result.runStatus,
          materializedDiff: result.materializedDiff,
        },
        {
          cwd: workspace.workspacePath,
          runId,
          lastAction: "kiwi_run_step",
          mutationScope: mutationScope({
            riskLabel: "MUTATES_WORKTREE",
            workspacePath: workspace.workspacePath,
            repoPath: workspace.repo?.path ?? null,
            executionMode: null,
          }),
        },
      );
    },
  );
}

export async function runTool(
  args: Record<string, unknown>,
  cwd: string,
  callOptions: ToolCallOptions = {},
): Promise<unknown> {
  const runId = String(args.runId ?? "");
  const workspace = workspaceArgs(args, cwd, false);
  const fromStep = typeof args.fromStep === "string" ? args.fromStep : undefined;
  const maxConcurrency = args.maxConcurrency as number | undefined;

  return services().core.locks.withLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: "mcp_run",
    },
    async () =>
      executeRunToolLocked({
        args,
        workspacePath: workspace.workspacePath,
        repoPath: workspace.repo?.path ?? null,
        runId,
        fromStep,
        maxConcurrency,
        callOptions,
      }),
  );
}
