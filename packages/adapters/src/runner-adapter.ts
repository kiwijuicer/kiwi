import { Artifact, GateResult, RunnerName } from "@kiwi/contracts";
import { SandboxCommandPolicy } from "@kiwi/sandbox";

export type RunnerExecutionStatus =
  | "completed"
  | "failed"
  | "blocked"
  | "approval_required"
  | "timeout";

export interface RunnerExecutionTimeouts {
  commandTimeoutMs: number;
}

export interface RunnerModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface RunnerExecutionError {
  code: string;
  message: string;
}

export interface RunnerExecutionInput {
  runId: string;
  stepId: string;
  attemptId: string;
  workspacePath: string;
  repoPath?: string;
  worktreePath: string;
  stepPrompt: string;
  contextPackage: unknown;
  allowedTools: string[];
  timeouts: RunnerExecutionTimeouts;
  command?: string[];
  commandPolicy?: SandboxCommandPolicy;
  env?: Record<string, string>;
  approved?: boolean;
  requestedAt?: string;
}

export interface RunnerExecutionOutput {
  status: RunnerExecutionStatus;
  artifactRefs: Artifact[];
  rawLogsRef: string | null;
  modelUsage: RunnerModelUsage;
  gateResult: GateResult;
  error?: RunnerExecutionError;
}

export interface RunnerAdapter {
  readonly name: RunnerName;
  execute(input: RunnerExecutionInput): Promise<RunnerExecutionOutput>;
}
