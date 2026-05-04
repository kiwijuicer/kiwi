import chalk from "chalk";
import { withRunLock, writeOperatorSnapshot } from "@ai-kiwi/core";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";

export interface OperatorSnapshotOptions extends CliWorkspaceOptions {
  now?: Date;
}

export async function runOperatorSnapshot(
  runId: string,
  opts: OperatorSnapshotOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const result = await withRunLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: "operator_snapshot",
      now: opts.now,
    },
    () =>
      writeOperatorSnapshot({
        cwd: workspace.workspacePath,
        runId,
        now: opts.now,
      }),
  );

  console.log(chalk.green("✓") + " Operator snapshot written");
  console.log(chalk.dim(`runId: ${runId}`));
  console.log(chalk.dim(`snapshot: .kiwi/runs/${runId}/${result.ref}`));
}
