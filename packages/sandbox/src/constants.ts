import type { RunnerExecutionStatus } from "@kiwi/contracts";

export const SandboxPolicyDecisionStatuses = {
  Allow: "allow",
} as const;

export type SandboxPolicyDecisionStatus =
  | (typeof SandboxPolicyDecisionStatuses)[keyof typeof SandboxPolicyDecisionStatuses]
  | RunnerExecutionStatus;

export const WorktreeIsolationKinds = {
  GitWorktree: "git-worktree",
  CopyFolder: "copy-folder",
} as const;

export type WorktreeIsolationKind = (typeof WorktreeIsolationKinds)[keyof typeof WorktreeIsolationKinds];

export const CommandOutputStreams = {
  Stdout: "stdout",
  Stderr: "stderr",
} as const;

export type CommandOutputStream = (typeof CommandOutputStreams)[keyof typeof CommandOutputStreams];
