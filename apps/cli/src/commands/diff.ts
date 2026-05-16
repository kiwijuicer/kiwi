import { applyRunDiff, buildRunDiff, formatRunDiff } from "@kiwi/runtime";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";

interface DiffOptions extends CliWorkspaceOptions {
  json?: boolean;
  all?: boolean;
}

export async function runDiff(
  runId: string,
  stepId?: string,
  opts: DiffOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const result = buildRunDiff({
    cwd: workspace.workspacePath,
    runId,
    ...(stepId ? { stepId } : {}),
    ...(opts.all ? { allAttempts: true } : {}),
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));

    return;
  }
  console.log(formatRunDiff(result));
}

interface ApplyOptions extends CliWorkspaceOptions {
  forceUnsafe?: boolean;
  json?: boolean;
}

export async function runApply(
  runId: string,
  stepId?: string,
  opts: ApplyOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const result = applyRunDiff({
    cwd: workspace.workspacePath,
    runId,
    ...(stepId ? { stepId } : {}),
    ...(opts.forceUnsafe ? { forceUnsafe: true } : {}),
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));

    return;
  }
  console.log(result.message);
}
