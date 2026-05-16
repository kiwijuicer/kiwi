import { ContractValues } from "@kiwi/contracts";
import { buildRunCompletionSummary } from "@kiwi/ops";
import {
  assertDirectExecutionSafe,
  DirectExecutionUnsafeError,
  type ExecutePlannedStepInput,
  type ExecutePlannedStepResult,
  runScheduledSubPlans,
  splitCommandLine,
} from "@kiwi/runtime";
import { withOperatorCard } from "./operator-card";
import { createMcpPreviewToken, normalizePreviewInput, validateMcpPreviewToken } from "./preview-tokens";
import { ToolActionRequiredError } from "./tool-errors";
import { errorMessage, previewConfirmationSummary, progressLine, type ToolCallOptions } from "./tool-helpers";
import { mutationScope, safeReadOnlyToolCalls, toolCall, type McpNextAction, workspaceToolArgs } from "./ux";
import { McpToolProgressStatuses } from "./constants";
import { createMcpServerServices } from "./services";
import { workspaceArgs } from "./workspace";

const mcpServices = createMcpServerServices();

interface RunStepToolResult {
  attemptId: string;
  status: string;
  nextAction: unknown;
  runStatus: string;
  materializedDiff: unknown;
}

function nextRunAction(params: {
  workspacePath: string;
  repoId?: string | null | undefined;
  repoPath?: string | null | undefined;
  runId: string;
  previewToken: string;
  fromStep?: string | undefined;
  maxConcurrency?: number | undefined;
}): McpNextAction {
  return {
    recommendedToolCall: toolCall("kiwi_run", {
      ...workspaceToolArgs(params),
      previewToken: params.previewToken,
      ...(params.fromStep ? { fromStep: params.fromStep } : {}),
      ...(params.maxConcurrency !== undefined && params.maxConcurrency !== 2
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

function emitPostAttemptProgress(params: {
  workspacePath: string;
  runId: string;
  stepId: string;
  attemptId: string;
  options: ToolCallOptions;
  stepIndex?: number | undefined;
  stepCount?: number | undefined;
}): void {
  if (!params.options.onProgress) {
    return;
  }
  const evidence = mcpServices.core.evidence
    .listStepAttempts(params.workspacePath, params.runId)
    .find((entry) => entry.stepId === params.stepId && entry.attemptId === params.attemptId);

  if (!evidence) {
    return;
  }
  for (const gate of evidence.gateResults) {
    params.options.onProgress(
      progressLine({
        phase: "gate",
        status: gate.status,
        stepId: params.stepId,
        attemptId: params.attemptId,
        gate: gate.gateType,
        reason: gate.reason,
        stepIndex: params.stepIndex,
        stepCount: params.stepCount,
      }),
    );
  }
  if (evidence.reviewVerdict) {
    params.options.onProgress(
      progressLine({
        phase: "review",
        status: ContractValues.Completed,
        stepId: params.stepId,
        attemptId: params.attemptId,
        verdict: evidence.reviewVerdict.verdict,
        safeToContinue: evidence.reviewVerdict.safeToContinue,
        stepIndex: params.stepIndex,
        stepCount: params.stepCount,
      }),
    );
  }
}

function parseMaxConcurrency(args: Record<string, unknown>): number | undefined {
  if (typeof args.maxConcurrency === "number") {
    return args.maxConcurrency;
  }
  if (typeof args.maxConcurrency !== "string" || args.maxConcurrency.trim().length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(args.maxConcurrency, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`kiwi_run maxConcurrency must be a positive integer; received ${args.maxConcurrency}`);
  }

  return parsed;
}

export function previewRunTool(args: Record<string, unknown>, cwd: string): unknown {
  const runId = String(args.runId ?? "");

  if (!runId) {
    throw new Error("kiwi_preview_run requires runId");
  }
  const workspace = workspaceArgs(args, cwd, false);
  const fromStep = typeof args.fromStep === "string" ? args.fromStep : undefined;
  const maxConcurrency = parseMaxConcurrency(args);

  if (maxConcurrency !== undefined && (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0)) {
    throw new Error(`kiwi_preview_run maxConcurrency must be a positive integer; received ${maxConcurrency}`);
  }
  const previewInput = normalizePreviewInput({ fromStep, maxConcurrency });
  const preview = mcpServices.runtime.execution.previews.build({
    cwd: workspace.workspacePath,
    runId,
    ...(fromStep ? { fromStep } : {}),
    ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
  });

  if (preview.executionIsolation === "direct") {
    const initiative = mcpServices.core.runs.loadInitiative(runId, workspace.workspacePath);
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

async function runStepToolUnlocked(
  args: Record<string, unknown>,
  workspacePath: string,
  options: ToolCallOptions = {},
  progressContext: { stepIndex?: number; stepCount?: number } = {},
): Promise<RunStepToolResult> {
  const runId = String(args.runId ?? "");
  const stepId = String(args.stepId ?? "");

  if (!runId || !stepId) {
    throw new Error("kiwi_run_step requires runId and stepId");
  }
  const input: ExecutePlannedStepInput = { cwd: workspacePath, runId, stepId };

  if (typeof args.command === "string") {
    input.command = splitCommandLine(args.command);
  }
  if (typeof args.attemptId === "string") {
    input.attemptId = args.attemptId;
  }
  const preview = mcpServices.runtime.execution.previews
    .build({ cwd: workspacePath, runId })
    .steps.find((step) => step.stepId === stepId);

  if (preview) {
    options.onProgress?.(
      progressLine({
        phase: "routing",
        status: McpToolProgressStatuses.Selected,
        stepId,
        model: preview.selectedModelId,
        providerModel: preview.selectedProviderModel,
        capability: preview.modelCapability,
        runner: preview.runner,
        isolation: preview.executionIsolation,
        reason: preview.executorSelectionReason ?? preview.routingReason.join(","),
        stepIndex: progressContext.stepIndex,
        stepCount: progressContext.stepCount,
      }),
      0,
    );
  }
  options.onProgress?.(
    progressLine({
      phase: "step",
      status: McpToolProgressStatuses.Started,
      stepId,
      stepIndex: progressContext.stepIndex,
      stepCount: progressContext.stepCount,
    }),
    0,
  );
  options.onProgress?.(
    progressLine({
      phase: "gate",
      status: ContractValues.Running,
      stepId,
      stepIndex: progressContext.stepIndex,
      stepCount: progressContext.stepCount,
    }),
  );
  let result: ExecutePlannedStepResult;

  try {
    result = await mcpServices.runtime.execution.plannedSteps.execute(input);
  } catch (error) {
    options.onProgress?.(
      progressLine({
        phase: "step",
        status: ContractValues.Failed,
        stepId,
        stepIndex: progressContext.stepIndex,
        stepCount: progressContext.stepCount,
        error: errorMessage(error),
      }),
      100,
    );
    throw error;
  }
  emitPostAttemptProgress({
    workspacePath,
    runId,
    stepId,
    attemptId: result.attemptId,
    options,
    stepIndex: progressContext.stepIndex,
    stepCount: progressContext.stepCount,
  });
  options.onProgress?.(
    progressLine({
      phase: "step",
      status: result.status,
      stepId,
      attemptId: result.attemptId,
      next: result.nextAction.type,
      runStatus: result.runStatus,
      stepIndex: progressContext.stepIndex,
      stepCount: progressContext.stepCount,
    }),
    100,
  );

  return {
    attemptId: result.attemptId,
    status: result.status,
    nextAction: result.nextAction,
    runStatus: result.runStatus,
    materializedDiff: result.materializedDiff,
  };
}

export async function runStepTool(
  args: Record<string, unknown>,
  cwd: string,
  options: ToolCallOptions = {},
): Promise<unknown> {
  const runId = String(args.runId ?? "");
  const stepId = String(args.stepId ?? "");

  if (!runId || !stepId) {
    throw new Error("kiwi_run_step requires runId and stepId");
  }
  const workspace = workspaceArgs(args, cwd, false);

  return mcpServices.core.locks.withLock(
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
      const result = await runStepToolUnlocked(args, workspace.workspacePath, options, { stepIndex: 1, stepCount: 1 });

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

  if (!runId) {
    throw new Error("kiwi_run requires runId");
  }
  const workspace = workspaceArgs(args, cwd, false);
  const fromStep = typeof args.fromStep === "string" ? args.fromStep : undefined;
  const maxConcurrency = parseMaxConcurrency(args);

  if (maxConcurrency !== undefined && (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0)) {
    throw new Error(`kiwi_run maxConcurrency must be a positive integer; received ${maxConcurrency}`);
  }

  return mcpServices.core.locks.withLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: "mcp_run",
    },
    async () => {
      const previewRecord = validateMcpPreviewToken({
        cwd: workspace.workspacePath,
        runId,
        previewToken: typeof args.previewToken === "string" ? args.previewToken : undefined,
        previewInput: normalizePreviewInput({ fromStep, maxConcurrency }),
      });

      if (previewRecord.executionIsolation === "direct") {
        assertMcpDirectExecutionSafe({
          workspacePath: workspace.workspacePath,
          repoPath: previewRecord.repoPath,
          runId,
        });
      }
      const taskGraph = mcpServices.core.runs.loadTaskGraph(runId, workspace.workspacePath);
      const steps: RunStepToolResult[] = [];
      callOptions.onProgress?.(progressLine({ phase: "run", status: McpToolProgressStatuses.Started, runId }), 0);

      if (taskGraph.subPlans && taskGraph.subPlans.length > 1) {
        await runScheduledSubPlans<{ command?: string }>({
          cwd: workspace.workspacePath,
          runId,
          ...(fromStep ? { fromStep } : {}),
          ...(maxConcurrency !== undefined ? { maxGlobalConcurrency: maxConcurrency } : {}),
          attemptOptions: {
            ...(typeof args.command === "string" ? { command: args.command } : {}),
          },
          runStep: async (_scheduledRunId, stepId, attemptOptions) => {
            const stepIndex = steps.length + 1;
            steps.push(
              await runStepToolUnlocked(
                {
                  ...args,
                  workspacePath: workspace.workspacePath,
                  runId,
                  stepId,
                  ...attemptOptions,
                },
                workspace.workspacePath,
                callOptions,
                { stepIndex, stepCount: taskGraph.steps.length },
              ),
            );
          },
        });
      } else {
        const startIndex = fromStep ? taskGraph.steps.findIndex((step) => step.stepId === fromStep) : 0;

        if (startIndex < 0) {
          throw new Error(`Step not found: ${fromStep}`);
        }

        const selectedSteps = taskGraph.steps.slice(startIndex);

        for (const [index, step] of selectedSteps.entries()) {
          steps.push(
            await runStepToolUnlocked(
              {
                ...args,
                workspacePath: workspace.workspacePath,
                runId,
                stepId: step.stepId,
              },
              workspace.workspacePath,
              callOptions,
              { stepIndex: index + 1, stepCount: selectedSteps.length },
            ),
          );
          const status = mcpServices.core.runStatus.summary(workspace.workspacePath, runId).latest[0]?.currentStatus;

          if (status === ContractValues.Failed || status === "needs_approval") {
            break;
          }
        }
      }

      const run = mcpServices.core.runStatus.summary(workspace.workspacePath, runId).latest[0];
      callOptions.onProgress?.(progressLine({ phase: "run", status: run?.currentStatus ?? "missing", runId }), 100);

      return withOperatorCard(
        {
          schemaVersion: "2",
          kind: "run_execution_result",
          runId,
          status: run?.currentStatus ?? "missing",
          steps,
          summary: buildRunCompletionSummary({ cwd: workspace.workspacePath, runId }),
        },
        {
          cwd: workspace.workspacePath,
          runId,
          lastAction: "kiwi_run",
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
