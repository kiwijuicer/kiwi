import chalk from "chalk";
import { ContractValues } from "@kiwi/contracts";
import { buildRunCompletionSummary, getRunStatusSummary, loadTaskGraph, withRunLock } from "@kiwi/core";
import { runAttemptUnlocked, AttemptOptions } from "./attempt";
import { resolveCliWorkspace } from "../workspace-options";
import { printRunCompletionSummary } from "./run-summary";

interface RunOptions extends AttemptOptions {
  fromStep?: string;
}

export async function runRun(runId: string, opts: RunOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  let stoppedStatus: string | undefined;
  let stoppedStepId: string | undefined;
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
          stoppedStatus = status;
          stoppedStepId = step.stepId;
          break;
        }
      }
    },
  );

  console.log(
    (stoppedStatus ? chalk.yellow("•") : chalk.green("✓")) +
      (stoppedStatus ? " Run stopped" : " Run attempts completed"),
  );
  console.log(chalk.dim(`runId: ${runId}`));
  printRunCompletionSummary(
    buildRunCompletionSummary({
      cwd: workspace.workspacePath,
      runId,
      ...(opts.now ? { now: opts.now } : {}),
    }),
  );
  if (stoppedStatus && stoppedStepId) {
    throw new Error(`Run stopped after ${stoppedStepId} with status ${stoppedStatus}`);
  }
}
