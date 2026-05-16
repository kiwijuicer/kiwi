import chalk from "chalk";
import { AttemptDiffStatuses, type ExecutePlannedStepResult, splitCommandLine } from "@kiwi/runtime";
import { createCliServices } from "../services";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";

const cliServices = createCliServices();

export interface AttemptOptions extends CliWorkspaceOptions {
  command?: string;
  approved?: boolean;
  attemptId?: string;
  now?: Date;
}

export async function runAttemptUnlocked(
  runId: string,
  stepId: string,
  opts: AttemptOptions = {},
  cwd: string = process.cwd(),
): Promise<ExecutePlannedStepResult> {
  const result = await cliServices.runtime.execution.plannedSteps.execute({
    cwd,
    runId,
    stepId,
    ...(opts.command ? { command: splitCommandLine(opts.command) } : {}),
    ...(opts.approved !== undefined ? { approved: opts.approved } : {}),
    ...(opts.attemptId ? { attemptId: opts.attemptId } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });

  console.log(chalk.green("✓") + " Step attempted");
  console.log(chalk.dim(`runId: ${runId}`));
  console.log(chalk.dim(`stepId: ${stepId}`));
  console.log(chalk.dim(`attemptId: ${result.attemptId}`));
  console.log(chalk.dim(`execution: ${result.executionMode}`));
  console.log(chalk.dim(`status: ${result.status}`));
  console.log(chalk.dim(`nextAction: ${result.nextAction.type}`));
  console.log(chalk.dim(`runStatus: ${result.runStatus}`));
  if (result.materializedDiff.status === AttemptDiffStatuses.Applied) {
    console.log(chalk.dim(`appliedDiff: ${result.materializedDiff.diffRef}`));
  } else {
    console.log(chalk.dim(`appliedDiff: ${result.materializedDiff.status} (${result.materializedDiff.reason})`));
  }

  return result;
}

export async function runAttempt(
  runId: string,
  stepId: string,
  opts: AttemptOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  await cliServices.core.locks.withLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: `attempt:${stepId}`,
      now: opts.now,
    },
    () => runAttemptUnlocked(runId, stepId, opts, workspace.workspacePath),
  );
}
