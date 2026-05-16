import type { loadTaskGraph, refreshRunStatusFromAttempts } from "@kiwi/core";
import type { SandboxCommandPolicy } from "@kiwi/sandbox";
import type { StepAttemptOrchestrator } from "../step-attempt-orchestrator";

export type ExecutionMode = "direct" | "worktree";
export type ExecutionOwner = "kiwi-codex-cli";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type StepAttemptExecutionResult = Awaited<ReturnType<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>>;

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
}

export type AttemptDiffMaterialization =
  | { status: "applied"; diffRef: string; patchPath: string; targetPath: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; diffRef: string; patchPath: string; targetPath: string; reason: string };

export interface ExecutionTarget {
  mode: ExecutionMode;
  runId: string;
  attemptId: string;
  worktreePath: string;
  sourcePath: string;
  isolation: "direct" | "git-worktree" | "copy-folder";
  diffBaseTree: string | null;
}

export interface RunExecutionPreviewStep {
  stepId: string;
  title: string;
  type: string;
  status: string;
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

export interface RunExecutionPreview {
  runId: string;
  executionOwner: ExecutionOwner;
  executionIsolation: ExecutionMode;
  maxConcurrency: number;
  subPlans: NonNullable<ReturnType<typeof loadTaskGraph>["subPlans"]>;
  steps: RunExecutionPreviewStep[];
}
