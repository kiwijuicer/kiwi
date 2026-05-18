import chalk from "chalk";
import { withRunLock } from "@kiwi/core";
import { finalizeRun } from "@kiwi/runtime";
import { buildRunCompletionSummary } from "@kiwi/ops";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../../workspace/options";
import { printRunCompletionSummary } from "../runs/run-summary";

interface FinalizeOptions extends CliWorkspaceOptions {
  now?: Date;
}

export async function runFinalize(
  runId: string,
  opts: FinalizeOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const input: Parameters<typeof finalizeRun>[0] = { cwd: workspace.workspacePath, runId };

  if (opts.now) {
    input.now = opts.now;
  }
  const result = await withRunLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: "finalize",
      now: opts.now,
    },
    () => finalizeRun(input),
  );

  console.log(chalk.green("✓") + " Run finalized");
  console.log(chalk.dim(`runId: ${runId}`));
  console.log(chalk.dim(`verdict: ${result.verdict.verdict}`));
  console.log(chalk.dim(`safeToApply: ${result.verdict.safeToApply}`));
  console.log(chalk.dim(`summary: .kiwi/runs/${runId}/${result.summaryRef}`));
  printRunCompletionSummary(
    buildRunCompletionSummary({
      cwd: workspace.workspacePath,
      runId,
      ...(opts.now ? { now: opts.now } : {}),
    }),
  );
}
