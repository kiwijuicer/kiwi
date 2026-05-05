import { Artifact, GateResult, GateType } from "@kiwi/contracts";

export type ApprovalState = "auto" | "required" | "blocked";
export type NetworkPolicy = "disabled" | "enabled";
export type SandboxExecutionStatus = "completed" | "failed" | "blocked" | "approval_required" | "timeout";

export interface SandboxCommandPolicy {
  allowedCommands: string[];
  approvalState: ApprovalState;
  approvalRequiredPaths: string[];
  deniedPaths: string[];
  envAllowlist: string[];
  secretValues: string[];
  networkPolicy: NetworkPolicy;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface SandboxCommandInput {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  worktreePath: string;
  command: string[];
  policy: SandboxCommandPolicy;
  env?: Record<string, string>;
  approved?: boolean;
  now?: Date;
  gateId?: string;
  gateType?: GateType;
  artifactLabel?: string;
}

export interface SandboxCommandOutput {
  status: SandboxExecutionStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  artifactRefs: Artifact[];
  gateResult: GateResult;
  startedAt: string;
  completedAt: string;
}
