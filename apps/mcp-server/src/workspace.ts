import path from "path";
import { isInitialized, resolveWorkspace, WorkspaceResolution } from "@kiwi/core";

export function workspaceArgs(args: Record<string, unknown>, cwd: string, requireRepo: boolean): WorkspaceResolution {
  const workspacePath = typeof args.workspacePath === "string" ? args.workspacePath : undefined;
  const repoPath = typeof args.repoPath === "string" ? args.repoPath : undefined;
  const repo = repoPath ? repoPath : typeof args.repoId === "string" ? args.repoId : undefined;

  if (workspacePath && repoPath) {
    const resolvedWorkspacePath = path.resolve(cwd, workspacePath);
    const resolvedRepoPath = path.resolve(cwd, repoPath);

    if (!isInitialized(resolvedWorkspacePath) && isInitialized(resolvedRepoPath)) {
      throw new Error(
        `Workspace path is not initialized: ${resolvedWorkspacePath}. Pass the initialized repo as workspacePath or run kiwi_doctor.`,
      );
    }
  }
  const input: Parameters<typeof resolveWorkspace>[0] = { cwd, requireRepo };

  if (workspacePath) {
    input.workspacePath = workspacePath;
  }
  if (repo) {
    input.repo = repo;
  }

  return resolveWorkspace(input);
}
