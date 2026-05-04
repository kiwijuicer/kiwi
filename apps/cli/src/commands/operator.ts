import chalk from "chalk";
import { withRunLock, writeOperatorSnapshot } from "@ai-kiwi/core";

export interface OperatorSnapshotOptions {
  now?: Date;
}

export async function runOperatorSnapshot(
  runId: string,
  opts: OperatorSnapshotOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const result = await withRunLock(
    {
      cwd,
      runId,
      operation: "operator_snapshot",
      now: opts.now,
    },
    () =>
      writeOperatorSnapshot({
        cwd,
        runId,
        now: opts.now,
      }),
  );

  console.log(chalk.green("✓") + " Operator snapshot written");
  console.log(chalk.dim(`runId: ${runId}`));
  console.log(chalk.dim(`snapshot: .kiwi/runs/${runId}/${result.ref}`));
}
