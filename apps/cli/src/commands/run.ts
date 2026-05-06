import chalk from "chalk";
import { ContractValues } from "@kiwi/contracts";
import { getRunStatusSummary, loadTaskGraph, withRunLock } from "@kiwi/core";
import { attemptReplan, ExecutePlannedStepResult, injectFixStep, loadReviewVerdict, runScheduledSubPlans } from "@kiwi/runtime";
import { buildRunCompletionSummary } from "@kiwi/ops";
import { runAttemptUnlocked, AttemptOptions } from "./attempt";
import { resolveCliWorkspace } from "../workspace-options";
import { printRunCompletionSummary } from "./run-summary";

interface RunOptions extends AttemptOptions {
  fromStep?: string;
  maxConcurrency?: number;
  autoFix?: boolean;
  autoReplan?: boolean;
}

interface StepStopResult {
  stoppedStatus?: string;
  stoppedStepId?: string;
}

/**
 * Try auto-fix (inject a fix step) or auto-replan (write versioned plan).
 * Returns true when the run should continue, false when it must stop.
 */
function tryAutoAction(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptResult: ExecutePlannedStepResult;
  opts: Pick<RunOptions, "autoFix" | "autoReplan" | "now">;
  stepIds: string[];
}): boolean {
  const { cwd, runId, stepId, attemptResult, opts, stepIds } = params;
  const nextType = attemptResult.nextAction.type;

  if (opts.autoFix && nextType === "fix_step") {
    const verdict = loadReviewVerdict({ cwd, runId, stepId, attemptId: attemptResult.attemptId });
    const injected = injectFixStep({ cwd, runId, focalStepId: stepId, reviewVerdict: verdict, ...(opts.now ? { now: opts.now } : {}) });
    console.log(chalk.yellow("↺") + ` auto-fix: injected ${injected.injectedStepId} after ${stepId}`);
    const idx = stepIds.indexOf(stepId);
    if (idx >= 0) stepIds.splice(idx + 1, 0, injected.injectedStepId);
    return true;
  }

  if (opts.autoReplan && nextType === "replan") {
    const verdict = loadReviewVerdict({ cwd, runId, stepId, attemptId: attemptResult.attemptId });
    const replanResult = attemptReplan({ cwd, runId, focalStepId: stepId, reviewVerdict: verdict, ...(opts.now ? { now: opts.now } : {}) });
    console.log(chalk.yellow("↻") + ` auto-replan: new plan written to ${replanResult.taskGraphPath}`);
    console.log(chalk.dim("Re-run with: kiwi run " + runId));
    return false;
  }

  return false;
}

async function runSequentialSteps(params: {
  cwd: string;
  runId: string;
  startIndex: number;
  taskGraphSteps: { stepId: string }[];
  attemptOptions: AttemptOptions;
  opts: RunOptions;
}): Promise<StepStopResult> {
  const { cwd, runId, startIndex, taskGraphSteps, attemptOptions, opts } = params;
  const stepIds: string[] = taskGraphSteps.slice(startIndex).map((s) => s.stepId);
  let i = 0;

  while (i < stepIds.length) {
    const stepId = stepIds[i]!;
    const attemptResult = await runAttemptUnlocked(runId, stepId, attemptOptions, cwd);
    const runStatus = getRunStatusSummary(cwd, runId).latest[0]?.status;

    if (runStatus === ContractValues.Failed || runStatus === "needs_approval") {
      if (runStatus !== "needs_approval") {
        const continued = tryAutoAction({ cwd, runId, stepId, attemptResult, opts, stepIds });
        if (continued) {
          i++;
          continue;
        }
      }
      return { stoppedStatus: runStatus, stoppedStepId: stepId };
    }
    i++;
  }

  return {};
}

export async function runRun(runId: string, opts: RunOptions = {}, cwd: string = process.cwd()): Promise<void> {
  if (opts.maxConcurrency !== undefined && (!Number.isInteger(opts.maxConcurrency) || opts.maxConcurrency <= 0)) {
    throw new Error(`--max-concurrency must be a positive integer; received ${opts.maxConcurrency}`);
  }

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
      const attemptOptions: AttemptOptions = {};
      if (opts.command) attemptOptions.command = opts.command;
      if (opts.approved !== undefined) attemptOptions.approved = opts.approved;
      if (opts.now) attemptOptions.now = opts.now;

      if (taskGraph.subPlans && taskGraph.subPlans.length > 1) {
        const scheduled = await runScheduledSubPlans<AttemptOptions>({
          cwd: workspace.workspacePath,
          runId,
          ...(opts.fromStep ? { fromStep: opts.fromStep } : {}),
          ...(opts.maxConcurrency !== undefined ? { maxGlobalConcurrency: opts.maxConcurrency } : {}),
          ...(opts.now ? { now: opts.now } : {}),
          attemptOptions,
          runStep: (_scheduledRunId, stepId, options) => runAttemptUnlocked(runId, stepId, options, workspace.workspacePath),
        });
        stoppedStatus = scheduled.stoppedStatus;
        stoppedStepId = scheduled.stoppedStepId;
        return;
      }

      const startIndex = opts.fromStep ? taskGraph.steps.findIndex((step) => step.stepId === opts.fromStep) : 0;
      if (startIndex < 0) throw new Error(`Step not found: ${opts.fromStep}`);

      const result = await runSequentialSteps({
        cwd: workspace.workspacePath,
        runId,
        startIndex,
        taskGraphSteps: taskGraph.steps,
        attemptOptions,
        opts,
      });
      stoppedStatus = result.stoppedStatus;
      stoppedStepId = result.stoppedStepId;
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
