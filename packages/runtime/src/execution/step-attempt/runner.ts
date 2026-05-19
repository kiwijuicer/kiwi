import path from "path";
import {
  ArtifactSchema,
  CodexSandboxes,
  ContractValues,
  ExecutionIsolations,
  GateResult,
  GateResultSchema,
  GateTypes,
  SchedulerDecisionStatuses,
} from "@kiwi/contracts";
import type {
  ExecuteStepAttemptInput,
  StepRunnerExecutionError,
  StepRunnerExecutionInput,
  StepRunnerExecutionOutput,
} from "../step-runner-types";

export function ensureRunnerMatchesDecision(input: ExecuteStepAttemptInput): void {
  if (input.schedulerDecision.status !== SchedulerDecisionStatuses.Scheduled) {
    throw new Error(`cannot execute blocked scheduler decision: ${input.schedulerDecision.blockedReason}`);
  }
  if (input.schedulerDecision.runner !== input.runner.name) {
    throw new Error(`runner mismatch: scheduler selected ${input.schedulerDecision.runner}, got ${input.runner.name}`);
  }
}

export function ensureIsolatedWorktree(workspacePath: string, worktreePath: string): void {
  if (path.resolve(workspacePath) === path.resolve(worktreePath)) {
    throw new Error("runner worktreePath must not be the main workspace path");
  }
}

export function ensureWorktreeIsNotSource(sourcePath: string, worktreePath: string): void {
  if (path.resolve(sourcePath) === path.resolve(worktreePath)) {
    throw new Error("runner worktreePath must not be the source repo path");
  }
}

function gateResultFromRunnerException(error: StepRunnerExecutionError, evidenceRefs: string[]): GateResult {
  return GateResultSchema.parse({
    gateId: "gate_runner_execution",
    gateType: GateTypes.ForbiddenFileChecks,
    status: ContractValues.Fail,
    evidenceRefs,
    reason: error.message,
  });
}

function normalizeRunnerException(error: unknown): {
  output: StepRunnerExecutionOutput;
} {
  const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const artifactRefs = Array.isArray(record.artifactRefs)
    ? record.artifactRefs.map((entry) => ArtifactSchema.parse(entry))
    : [];
  const message = error instanceof Error ? error.message : String(error);
  const structuredError: StepRunnerExecutionError = {
    code: typeof record.code === "string" ? record.code : "RUNNER_EXCEPTION",
    message,
  };

  return {
    output: {
      status: ContractValues.Failed,
      artifactRefs,
      rawLogsRef: artifactRefs[0]?.ref ?? null,
      modelUsage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      gateResult: gateResultFromRunnerException(
        structuredError,
        artifactRefs.map((entry) => entry.ref),
      ),
      error: structuredError,
    },
  };
}

function buildRunnerInput<TCommandPolicy>(
  input: ExecuteStepAttemptInput<TCommandPolicy>,
  contextPackage: StepRunnerExecutionInput<TCommandPolicy>["contextPackage"],
  requestedAt: string,
): StepRunnerExecutionInput<TCommandPolicy> {
  const runnerInput: StepRunnerExecutionInput<TCommandPolicy> = {
    runId: input.schedulerDecision.runId,
    stepId: input.step.stepId,
    attemptId: input.schedulerDecision.attemptId,
    workspacePath: input.cwd,
    worktreePath: input.worktreePath,
    executionMode: input.executionMode ?? ExecutionIsolations.Worktree,
    codexSandbox: input.codexSandbox ?? CodexSandboxes.WorkspaceWrite,
    diffBaseTree: input.diffBaseTree ?? null,
    step: {
      stepId: input.step.stepId,
      type: input.step.type,
      title: input.step.title,
      successCriteria: input.step.successCriteria,
      requiredGates: input.step.requiredGates,
    },
    contextPackage,
    allowedTools: input.allowedTools ?? [],
    timeouts: input.timeouts ?? { commandTimeoutMs: 120_000 },
    requestedAt,
  };

  if (input.repoPath) {
    runnerInput.repoPath = input.repoPath;
  }
  if (input.command) {
    runnerInput.command = input.command;
  }
  if (input.commandPolicy !== undefined) {
    runnerInput.commandPolicy = input.commandPolicy;
  }
  if (input.env) {
    runnerInput.env = input.env;
  }
  if (input.approved !== undefined) {
    runnerInput.approved = input.approved;
  }

  return runnerInput;
}

export async function executeStepRunner<TCommandPolicy>(params: {
  input: ExecuteStepAttemptInput<TCommandPolicy>;
  contextPackage: StepRunnerExecutionInput<TCommandPolicy>["contextPackage"];
  startedAt: string;
}): Promise<StepRunnerExecutionOutput> {
  let runnerOutput: StepRunnerExecutionOutput;

  try {
    runnerOutput = await params.input.runner.execute(
      buildRunnerInput(params.input, params.contextPackage, params.startedAt),
    );
  } catch (error) {
    runnerOutput = normalizeRunnerException(error).output;
  }

  return {
    ...runnerOutput,
    artifactRefs: runnerOutput.artifactRefs.map((entry) => ArtifactSchema.parse(entry)),
    gateResult: GateResultSchema.parse(runnerOutput.gateResult),
  };
}
