import chalk from "chalk";
import { ContractValues } from "@kiwi/contracts";
import { getRunStatusSummary, loadTaskGraph, withRunLock } from "@kiwi/core";
import { runAttemptUnlocked, AttemptOptions } from "./attempt";
import { resolveCliWorkspace } from "../workspace-options";

interface RunOptions extends AttemptOptions {
  fromStep?: string;
}

export async function runRun(runId: string, opts: RunOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  await withRunLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: "run",
      now: opts.now,
    },
    async () => {
      const taskGraph = loadTaskGraph(runId, workspace.workspacePath);
      const startIndex = opts.fromStep ? taskGraph.steps.findIndex((step) => step.stepId === opts.fromStep) : 0;
      if (startIndex < 0) throw new Error(`Step not found: ${opts.fromStep}`);

      for (const step of taskGraph.steps.slice(startIndex)) {
        const attemptOptions: AttemptOptions = {};
        if (opts.command) attemptOptions.command = opts.command;
        if (opts.approved !== undefined) attemptOptions.approved = opts.approved;
        if (opts.now) attemptOptions.now = opts.now;
        await runAttemptUnlocked(runId, step.stepId, attemptOptions, workspace.workspacePath);
        const status = getRunStatusSummary(workspace.workspacePath, runId).latest[0]?.status;
        if (status === ContractValues.Failed || status === "needs_approval") {
          throw new Error(`Run stopped after ${step.stepId} with status ${status}`);
        }
      }
    },
  );

  console.log(chalk.green("✓") + " Run attempts completed");
  console.log(chalk.dim(`runId: ${runId}`));
}
