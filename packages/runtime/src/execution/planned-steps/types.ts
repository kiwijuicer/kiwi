import type { loadTaskGraph, refreshRunStatusFromAttempts } from "@kiwi/core";
import { ContractValues, ExecutionIsolations } from "@kiwi/contracts";
import type {
  CodexSandbox,
  ExecutionIsolation,
  ExecutionOwner as ContractExecutionOwner,
  ModelEntry,
  SchedulerDecision,
} from "@kiwi/contracts";
import type { SandboxCommandPolicy } from "@kiwi/sandbox";
import type { WorktreeIsolationKind } from "@kiwi/sandbox";
import type { StepAttemptOrchestrator } from "../step-attempt-orchestrator.js";
import type { StepAttemptRunner } from "../step-runner-types.js";

export type ExecutionMode = ExecutionIsolation;
export type ExecutionOwner = ContractExecutionOwner;
export type CodexSandboxMode = CodexSandbox;
export type StepAttemptExecutionResult = Awaited<ReturnType<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>>;

export const AttemptDiffStatuses = {
  Applied: "applied",
  Skipped: "skipped",
  Failed: ContractValues.Failed,
} as const;

export const ExecutionToolNames = {
  Shell: "shell",
} as const;

export const ExecutorSelectionReasons = {
  LocalResearcher: "local_researcher",
  ResearcherProvider: "researcher_provider",
  ExplicitCommand: "explicit_command",
  NoModelAvailable: "no_model_available",
} as const;

export const PREVIEW_ATTEMPT_ID_PREFIX = "attempt_preview_";
export const DEFAULT_MAX_CONCURRENCY = 2;

export interface ExecutePlannedStepInput {
  cwd: string;
  runId: string;
  stepId: string;
  command?: string[];
  approved?: boolean;
  attemptId?: string;
  now?: Date;
}

export interface ExecutePlannedStepResult {
  runId: string;
  stepId: string;
  attemptId: string;
  executionMode: ExecutionMode;
  status: StepAttemptExecutionResult["status"];
  nextAction: StepAttemptExecutionResult["nextAction"];
  runStatus: ReturnType<typeof refreshRunStatusFromAttempts>["status"];
  materializedDiff: AttemptDiffMaterialization;
  fallback?: ProviderFallbackResult;
}

export interface ProviderFallbackResult {
  reason: string;
  failedAttemptId: string;
  failedRunner: string;
  replacementAttemptId: string;
  replacementRunner: string;
  replacementModelId: string | null;
}

export type AttemptDiffMaterialization =
  | { status: typeof AttemptDiffStatuses.Applied; diffRef: string; patchPath: string; targetPath: string }
  | { status: typeof AttemptDiffStatuses.Skipped; reason: string }
  | {
      status: typeof AttemptDiffStatuses.Failed;
      diffRef: string;
      patchPath: string;
      targetPath: string;
      reason: string;
    };

export interface ExecutionTarget {
  mode: ExecutionMode;
  runId: string;
  attemptId: string;
  worktreePath: string;
  sourcePath: string;
  isolation: typeof ExecutionIsolations.Direct | WorktreeIsolationKind;
  diffBaseTree: string | null;
}

export interface RunExecutionPreviewStep {
  stepId: string;
  title: string;
  type: string;
  status: SchedulerDecision["status"];
  blockedReason?: string;
  agentRole: string;
  modelCapability: string;
  runner: string | null;
  selectedModelId: string | null;
  selectedProviderModel: string | null;
  selectedAccessMode: string | null;
  executorSelectionReason: string | null;
  estimatedAttemptCostUsd: number;
  reviewDepth: string;
  requiredGates: string[];
  routingReason: string[];
  contextLevel: string;
  executionOwner: ExecutionOwner;
  executionIsolation: ExecutionMode;
}

export interface StepRunnerSelection {
  runnerAdapter: StepAttemptRunner<SandboxCommandPolicy>;
  selectedModel: ModelEntry | null;
  selectedModelId: string | null;
  executorSelectionReason: string | null;
}

export interface StepPreviewSelection {
  selectedModel: ModelEntry | null;
  selectedModelId: string | null;
  reason: string | null;
}

export interface RunAttemptResult {
  result: StepAttemptExecutionResult;
  materializedDiff: AttemptDiffMaterialization;
}

export interface RunExecutionPreview {
  runId: string;
  executionOwner: ExecutionOwner;
  executionIsolation: ExecutionMode;
  maxConcurrency: number;
  subPlans: NonNullable<ReturnType<typeof loadTaskGraph>["subPlans"]>;
  steps: RunExecutionPreviewStep[];
}
