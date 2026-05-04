import { resolveWorkspace, WorkspaceResolution } from "@ai-kiwi/core";

export interface CliWorkspaceOptions {
  workspace?: string;
  repo?: string;
}

export function resolveCliWorkspace(
  opts: CliWorkspaceOptions = {},
  cwd: string = process.cwd(),
  requireRepo: boolean = false,
): WorkspaceResolution {
  const input: Parameters<typeof resolveWorkspace>[0] = {
    cwd,
    requireRepo,
  };
  if (opts.workspace) input.workspacePath = opts.workspace;
  if (opts.repo) input.repo = opts.repo;
  return resolveWorkspace(input);
}
