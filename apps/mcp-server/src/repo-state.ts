import { readExecutionRepoState, type ExecutionRepoState } from "@kiwi/runtime";

type McpRepoState = ExecutionRepoState;

export function readRepoState(repoPath: string): McpRepoState {
  return readExecutionRepoState(repoPath);
}
