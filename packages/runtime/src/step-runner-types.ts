import type {
  AccessMode,
  Artifact,
  CodexSandbox,
  ExecutionIsolation,
  GateResult,
  NextActionType,
  RunnerExecutionStatus,
  RunnerName,
  Step,
  UsagePrecision,
} from "@kiwi/contracts";

export type StepRunnerExecutionStatus = RunnerExecutionStatus;

export interface StepRunnerExecutionTimeouts {
  commandTimeoutMs: number;
}

export interface StepRunnerModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StepRunnerExecutionError {
  code: string;
  message: string;
}

export interface StepRunnerExecutionInput<TCommandPolicy = unknown> {
  runId: string;
  stepId: string;
  attemptId: string;
  workspacePath: string;
  repoPath?: string;
  worktreePath: string;
  executionMode?: ExecutionIsolation;
  codexSandbox?: CodexSandbox;
  diffBaseTree?: string | null;
  stepPrompt: string;
  contextPackage: unknown;
  allowedTools: string[];
  timeouts: StepRunnerExecutionTimeouts;
  command?: string[];
  commandPolicy?: TCommandPolicy;
  env?: Record<string, string>;
  approved?: boolean;
  requestedAt?: string;
}

export interface StepRunnerExecutionOutput {
  status: StepRunnerExecutionStatus;
  artifactRefs: Artifact[];
  rawLogsRef: string | null;
  modelUsage: StepRunnerModelUsage;
  modelId?: string | null;
  providerName?: string;
  accessMode?: AccessMode;
  usagePrecision?: UsagePrecision;
  estimatedCostUsd?: number | null;
  gateResult: GateResult;
  error?: StepRunnerExecutionError;
}

export interface StepAttemptRunner<TCommandPolicy = unknown> {
  readonly name: RunnerName;
  execute(input: StepRunnerExecutionInput<TCommandPolicy>): Promise<StepRunnerExecutionOutput>;
}

export interface StepAttemptNextAction {
  type: NextActionType;
  reason: string;
  recommendedNextSteps: string[];
  issueCodes: string[];
}

export interface ExecuteStepAttemptInput<TCommandPolicy = unknown> {
  cwd: string;
  repoPath?: string;
  step: Step;
  schedulerDecision: import("./scheduler-policy").SchedulerDecision;
  selectedModelId?: string | null;
  runner: StepAttemptRunner<TCommandPolicy>;
  worktreePath: string;
  executionMode?: ExecutionIsolation;
  codexSandbox?: CodexSandbox;
  diffBaseTree?: string | null;
  stepPrompt: string;
  allowedTools?: string[];
  timeouts?: StepRunnerExecutionTimeouts;
  command?: string[];
  commandPolicy?: TCommandPolicy;
  env?: Record<string, string>;
  approved?: boolean;
  approvedFiles?: string[];
  additionalGateResults?: GateResult[];
  additionalArtifacts?: Artifact[];
  postRunnerGateExecutor?: (params: {
    diff: string | null;
    diffHash: string | null;
    startedAt: string;
  }) => Promise<{ gateResults: GateResult[]; artifacts: Artifact[] }>;
  reviewEngine?: import("./review-engine").ReviewEngine;
  policy?: import("@kiwi/contracts").KiwiPolicy;
  now?: Date;
}
