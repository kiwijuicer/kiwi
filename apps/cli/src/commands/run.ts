import chalk from "chalk";
import { getRunStatusSummary, loadTaskGraph, withRunLock } from "@ai-kiwi/core";
import { runAttemptUnlocked, AttemptOptions } from "./attempt";

export interface RunOptions extends AttemptOptions {
  fromStep?: string;
}

export async function runRun(
  runId: string,
  opts: RunOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  await withRunLock(
    {
      cwd,
      runId,
      operation: "run",
      now: opts.now,
    },
    async () => {
      const taskGraph = loadTaskGraph(runId, cwd);
      const startIndex = opts.fromStep
        ? taskGraph.steps.findIndex((step) => step.stepId === opts.fromStep)
        : 0;
      if (startIndex < 0) throw new Error(`Step not found: ${opts.fromStep}`);

      for (const step of taskGraph.steps.slice(startIndex)) {
        const attemptOptions: AttemptOptions = {};
        if (opts.command) attemptOptions.command = opts.command;
        if (opts.approved !== undefined) attemptOptions.approved = opts.approved;
        if (opts.now) attemptOptions.now = opts.now;
        await runAttemptUnlocked(runId, step.stepId, attemptOptions, cwd);
        const status = getRunStatusSummary(cwd, runId).latest[0]?.status;
        if (status === "failed" || status === "needs_approval") {
          throw new Error(`Run stopped after ${step.stepId} with status ${status}`);
        }
      }
    },
  );

  console.log(chalk.green("✓") + " Run attempts completed");
  console.log(chalk.dim(`runId: ${runId}`));
}
