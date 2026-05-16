import { readExecutionRepoState, type ExecutionRepoState } from "@kiwi/runtime";

export type McpRepoState = ExecutionRepoState;

export function readRepoState(repoPath: string): McpRepoState {
  return readExecutionRepoState(repoPath);
}
