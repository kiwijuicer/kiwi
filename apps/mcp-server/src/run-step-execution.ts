import { ProgressStatuses, StepAttemptStatuses, StepStatuses } from "@kiwi/contracts";
import {
  type ExecutePlannedStepInput,
  type ExecutePlannedStepResult,
  type RunExecutionPreviewStep,
  splitCommandLine,
} from "@kiwi/runtime";
import { getMcpServerServices } from "./services";
import { errorMessage, progressLine, type ToolCallOptions } from "./tool-helpers";

export interface RunStepToolResult {
  stepId: string;
  attemptId: string;
  status: string;
  nextAction: unknown;
  runStatus: string;
  materializedDiff: unknown;
}

export interface InternalAttemptOptions {
  attemptId?: string;
  command?: string;
}

export interface RunStepProgressContext {
  stepIndex?: number;
  stepCount?: number;
  previewStep?: RunExecutionPreviewStep | null;
}

function services(): ReturnType<typeof getMcpServerServices> {
  return getMcpServerServices();
}

function latestCompletedAttempt(params: { workspacePath: string; runId: string; stepId: string }) {
  const latest = services()
    .core.evidence.latestAttemptByStep(services().core.evidence.listStepAttempts(params.workspacePath, params.runId))
    .get(params.stepId);

  return latest?.attempt.status === StepAttemptStatuses.Completed ? latest : null;
}

function buildStepInput(params: {
  args: Record<string, unknown>;
  workspacePath: string;
  runId: string;
  stepId: string;
  internalAttemptOptions: InternalAttemptOptions;
}): ExecutePlannedStepInput {
  const input: ExecutePlannedStepInput = {
    cwd: params.workspacePath,
    runId: params.runId,
    stepId: params.stepId,
  };
  const command =
    params.internalAttemptOptions.command ??
    (typeof params.args.command === "string" ? params.args.command : undefined);

  if (command) {
    input.command = splitCommandLine(command);
  }
  if (params.internalAttemptOptions.attemptId) {
    input.attemptId = params.internalAttemptOptions.attemptId;
  }

  return input;
}

function resolvePreviewStep(params: {
  workspacePath: string;
  runId: string;
  stepId: string;
  progressContext: RunStepProgressContext;
}): RunExecutionPreviewStep | null | undefined {
  return (
    params.progressContext.previewStep ??
    services()
      .runtime.execution.previews.build({ cwd: params.workspacePath, runId: params.runId })
      .steps.find((step) => step.stepId === params.stepId)
  );
}

function emitRoutingProgress(params: {
  stepId: string;
  preview: RunExecutionPreviewStep | null | undefined;
  options: ToolCallOptions;
  progressContext: RunStepProgressContext;
}): void {
  if (!params.preview) {
    return;
  }
  params.options.onProgress?.(
    progressLine({
      phase: "routing",
      status: ProgressStatuses.Selected,
      stepId: params.stepId,
      model: params.preview.selectedModelId,
      providerModel: params.preview.selectedProviderModel,
      capability: params.preview.modelCapability,
      runner: params.preview.runner,
      isolation: params.preview.executionIsolation,
      reason: params.preview.executorSelectionReason ?? params.preview.routingReason.join(","),
      stepIndex: params.progressContext.stepIndex,
      stepCount: params.progressContext.stepCount,
    }),
    0,
  );
}

function skippedCompletedResult(params: {
  workspacePath: string;
  runId: string;
  stepId: string;
  attemptId: string;
  options: ToolCallOptions;
  progressContext: RunStepProgressContext;
}): RunStepToolResult {
  const runStatus =
    services().core.runStatus.summary(params.workspacePath, params.runId).latest[0]?.currentStatus ?? "missing";

  params.options.onProgress?.(
    progressLine({
      phase: "step",
      status: ProgressStatuses.Skipped,
      stepId: params.stepId,
      attemptId: params.attemptId,
      reason: "already_completed",
      runStatus,
      stepIndex: params.progressContext.stepIndex,
      stepCount: params.progressContext.stepCount,
    }),
    100,
  );

  return {
    stepId: params.stepId,
    attemptId: params.attemptId,
    status: StepStatuses.Skipped,
    nextAction: {
      type: "skipped",
      reason: "already_completed",
      completedAttemptId: params.attemptId,
    },
    runStatus,
    materializedDiff: null,
  };
}

function emitStepStartProgress(params: {
  stepId: string;
  options: ToolCallOptions;
  progressContext: RunStepProgressContext;
}): void {
  params.options.onProgress?.(
    progressLine({
      phase: "step",
      status: ProgressStatuses.Started,
      stepId: params.stepId,
      stepIndex: params.progressContext.stepIndex,
      stepCount: params.progressContext.stepCount,
    }),
    0,
  );
  params.options.onProgress?.(
    progressLine({
      phase: "gate",
      status: ProgressStatuses.Running,
      stepId: params.stepId,
      stepIndex: params.progressContext.stepIndex,
      stepCount: params.progressContext.stepCount,
    }),
  );
}

async function executePlannedStep(params: {
  input: ExecutePlannedStepInput;
  stepId: string;
  options: ToolCallOptions;
  progressContext: RunStepProgressContext;
}): Promise<ExecutePlannedStepResult> {
  try {
    return await services().runtime.execution.plannedSteps.execute(params.input);
  } catch (error) {
    params.options.onProgress?.(
      progressLine({
        phase: "step",
        status: ProgressStatuses.Failed,
        stepId: params.stepId,
        stepIndex: params.progressContext.stepIndex,
        stepCount: params.progressContext.stepCount,
        error: errorMessage(error),
      }),
      100,
    );
    throw error;
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
  const evidence = services()
    .core.evidence.listStepAttempts(params.workspacePath, params.runId)
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
        status: ProgressStatuses.Completed,
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

function emitStepResultProgress(params: {
  stepId: string;
  result: ExecutePlannedStepResult;
  options: ToolCallOptions;
  progressContext: RunStepProgressContext;
}): void {
  params.options.onProgress?.(
    progressLine({
      phase: "step",
      status: params.result.status,
      stepId: params.stepId,
      attemptId: params.result.attemptId,
      next: params.result.nextAction.type,
      runStatus: params.result.runStatus,
      stepIndex: params.progressContext.stepIndex,
      stepCount: params.progressContext.stepCount,
    }),
    100,
  );
}

function toRunStepToolResult(stepId: string, result: ExecutePlannedStepResult): RunStepToolResult {
  return {
    stepId,
    attemptId: result.attemptId,
    status: result.status,
    nextAction: result.nextAction,
    runStatus: result.runStatus,
    materializedDiff: result.materializedDiff,
  };
}

export async function runStepToolUnlocked(
  args: Record<string, unknown>,
  workspacePath: string,
  options: ToolCallOptions = {},
  progressContext: RunStepProgressContext = {},
  internalAttemptOptions: InternalAttemptOptions = {},
): Promise<RunStepToolResult> {
  const runId = String(args.runId ?? "");
  const stepId = String(args.stepId ?? "");
  const input = buildStepInput({ args, workspacePath, runId, stepId, internalAttemptOptions });
  const preview = resolvePreviewStep({ workspacePath, runId, stepId, progressContext });

  emitRoutingProgress({ stepId, preview, options, progressContext });
  const completedAttempt = latestCompletedAttempt({ workspacePath, runId, stepId });

  if (completedAttempt) {
    return skippedCompletedResult({
      workspacePath,
      runId,
      stepId,
      attemptId: completedAttempt.attemptId,
      options,
      progressContext,
    });
  }

  emitStepStartProgress({ stepId, options, progressContext });
  const result = await executePlannedStep({ input, stepId, options, progressContext });

  emitPostAttemptProgress({
    workspacePath,
    runId,
    stepId,
    attemptId: result.attemptId,
    options,
    stepIndex: progressContext.stepIndex,
    stepCount: progressContext.stepCount,
  });
  emitStepResultProgress({ stepId, result, options, progressContext });

  return toRunStepToolResult(stepId, result);
}
