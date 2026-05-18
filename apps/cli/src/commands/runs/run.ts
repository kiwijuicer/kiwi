import chalk from "chalk";
import { ContractValues } from "@kiwi/contracts";
import {
  buildRunCostForecast,
  firstBudgetProfileForCost,
  getRunStatusSummary,
  loadPlannerCostReport,
  loadTaskGraph,
  withRunLock,
} from "@kiwi/core";
import {
  attemptReplan,
  ExecutePlannedStepResult,
  injectFixStep,
  loadReviewVerdict,
  runScheduledSubPlans,
} from "@kiwi/runtime";
import { buildRunCompletionSummary } from "@kiwi/ops";
import { runAttemptUnlocked, AttemptOptions } from "../execution/attempt";
import { resolveCliWorkspace } from "../../workspace/options";
import { printRunCompletionSummary } from "./run-summary";

interface RunOptions extends AttemptOptions {
  fromStep?: string;
  maxConcurrency?: number;
  autoFix?: boolean;
  autoReplan?: boolean;
  maxCost?: number;
  progress?: RunProgressOptions;
}

interface StepStopResult {
  stoppedStatus?: string;
  stoppedStepId?: string;
}

interface RunProgressOptions {
  enabled?: boolean;
  write?: (line: string) => void;
  nowMs?: () => number;
}

interface RunProgressReporter {
  line(line: string): void;
  stepStart(stepId: string, title?: string): void;
  stepDone(stepId: string, result: ExecutePlannedStepResult, runStatus?: string): void;
  stepFailed(stepId: string, error: unknown): void;
  stopAll(): void;
}

function createRunProgressReporter(opts: RunProgressOptions | undefined): RunProgressReporter {
  const enabled = opts?.enabled ?? process.stderr.isTTY;
  const write = opts?.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const nowMs = opts?.nowMs ?? (() => Date.now());
  const active = new Map<string, { startedAt: number; timer: NodeJS.Timeout }>();

  function stopStep(stepId: string): void {
    const entry = active.get(stepId);

    if (!entry) {
      return;
    }
    clearInterval(entry.timer);
    active.delete(stepId);
  }

  function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  return {
    line(line: string): void {
      if (!enabled) {
        return;
      }
      write(line);
    },
    stepStart(stepId: string, title?: string): void {
      if (!enabled) {
        return;
      }
      write(title ? `step ${stepId}: ${title}` : `step ${stepId}`);
      write("executing attempt and review...");
      const startedAt = nowMs();
      const timer = setInterval(() => {
        const elapsedSeconds = Math.max(0, Math.floor((nowMs() - startedAt) / 1000));
        write(`still running ${stepId}... ${elapsedSeconds}s elapsed`);
      }, 30_000);
      active.set(stepId, { startedAt, timer });
    },
    stepDone(stepId: string, result: ExecutePlannedStepResult, runStatus?: string): void {
      if (!enabled) {
        return;
      }
      stopStep(stepId);
      write(
        `step ${stepId} done: status=${result.status} next=${result.nextAction.type} runStatus=${runStatus ?? result.runStatus}`,
      );
    },
    stepFailed(stepId: string, error: unknown): void {
      if (!enabled) {
        return;
      }
      stopStep(stepId);
      write(`step ${stepId} failed: ${message(error)}`);
    },
    stopAll(): void {
      for (const stepId of active.keys()) {
        stopStep(stepId);
      }
    },
  };
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function plannerCostUsd(cwd: string, runId: string): number {
  try {
    return loadPlannerCostReport(cwd, runId).cost.estimatedUsd;
  } catch {
    return 0;
  }
}

function assertWithinRunMaxCost(params: {
  cwd: string;
  runId: string;
  taskGraph: ReturnType<typeof loadTaskGraph>;
  maxCost?: number;
}): void {
  if (params.maxCost === undefined) {
    return;
  }
  const forecast = buildRunCostForecast({
    taskGraph: params.taskGraph,
    plannerCostUsd: plannerCostUsd(params.cwd, params.runId),
  });

  if (forecast.estimatedCostUsd <= params.maxCost) {
    return;
  }
  const profile = firstBudgetProfileForCost(forecast.estimatedCostUsd);
  const hint = profile ? ` Re-plan with --budget-profile ${profile} if this run is intentional.` : "";
  throw new Error(
    `Estimated run cost ${formatUsd(forecast.estimatedCostUsd)} exceeds --max-cost ${formatUsd(params.maxCost)}.${hint}`,
  );
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
    const injected = injectFixStep({
      cwd,
      runId,
      focalStepId: stepId,
      reviewVerdict: verdict,
      ...(opts.now ? { now: opts.now } : {}),
    });
    console.log(chalk.yellow("↺") + ` auto-fix: injected ${injected.injectedStepId} after ${stepId}`);
    const idx = stepIds.indexOf(stepId);

    if (idx >= 0) {
      stepIds.splice(idx + 1, 0, injected.injectedStepId);
    }

    return true;
  }

  if (opts.autoReplan && nextType === "replan") {
    const verdict = loadReviewVerdict({ cwd, runId, stepId, attemptId: attemptResult.attemptId });
    const replanResult = attemptReplan({
      cwd,
      runId,
      focalStepId: stepId,
      reviewVerdict: verdict,
      ...(opts.now ? { now: opts.now } : {}),
    });
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
  taskGraphSteps: { stepId: string; title?: string }[];
  attemptOptions: AttemptOptions;
  opts: RunOptions;
  progress: RunProgressReporter;
}): Promise<StepStopResult> {
  const { cwd, runId, startIndex, taskGraphSteps, attemptOptions, opts, progress } = params;
  const stepIds: string[] = taskGraphSteps.slice(startIndex).map((s) => s.stepId);
  const titlesByStepId = new Map(taskGraphSteps.map((step) => [step.stepId, step.title]));
  let i = 0;

  while (i < stepIds.length) {
    const stepId = stepIds[i]!;
    progress.stepStart(stepId, titlesByStepId.get(stepId));
    let attemptResult: ExecutePlannedStepResult;

    try {
      attemptResult = await runAttemptUnlocked(runId, stepId, attemptOptions, cwd);
    } catch (error) {
      progress.stepFailed(stepId, error);
      throw error;
    }
    const runStatus = getRunStatusSummary(cwd, runId).latest[0]?.currentStatus;
    progress.stepDone(stepId, attemptResult, runStatus);

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
  if (opts.maxCost !== undefined && (!Number.isFinite(opts.maxCost) || opts.maxCost < 0)) {
    throw new Error(`--max-cost must be a non-negative number; received ${opts.maxCost}`);
  }

  const progress = createRunProgressReporter(opts.progress);
  const workspace = resolveCliWorkspace(opts, cwd, false);
  progress.line("Running run...");
  progress.line(chalk.dim(`runId: ${runId}`));
  progress.line(chalk.dim(`workspace: ${workspace.workspacePath}`));
  let stoppedStatus: string | undefined;
  let stoppedStepId: string | undefined;

  try {
    await withRunLock(
      {
        cwd: workspace.workspacePath,
        runId,
        operation: "run",
        now: opts.now,
      },
      async () => {
        const taskGraph = loadTaskGraph(runId, workspace.workspacePath);
        const maxCostInput: Parameters<typeof assertWithinRunMaxCost>[0] = {
          cwd: workspace.workspacePath,
          runId,
          taskGraph,
        };

        if (opts.maxCost !== undefined) {
          maxCostInput.maxCost = opts.maxCost;
        }
        assertWithinRunMaxCost(maxCostInput);
        const titlesByStepId = new Map(taskGraph.steps.map((step) => [step.stepId, step.title]));
        progress.line(chalk.dim(`steps: ${taskGraph.steps.length}`));
        if (opts.fromStep) {
          progress.line(chalk.dim(`fromStep: ${opts.fromStep}`));
        }
        const attemptOptions: AttemptOptions = {};

        if (opts.command) {
          attemptOptions.command = opts.command;
        }
        if (opts.approved !== undefined) {
          attemptOptions.approved = opts.approved;
        }
        if (opts.now) {
          attemptOptions.now = opts.now;
        }

        if (taskGraph.subPlans && taskGraph.subPlans.length > 1) {
          progress.line(chalk.dim(`subplans: ${taskGraph.subPlans.length}`));
          progress.line(chalk.dim(`maxConcurrency: ${opts.maxConcurrency ?? 2}`));
          const scheduled = await runScheduledSubPlans<AttemptOptions>({
            cwd: workspace.workspacePath,
            runId,
            ...(opts.fromStep ? { fromStep: opts.fromStep } : {}),
            ...(opts.maxConcurrency !== undefined ? { maxGlobalConcurrency: opts.maxConcurrency } : {}),
            ...(opts.now ? { now: opts.now } : {}),
            attemptOptions,
            runStep: async (_scheduledRunId, stepId, options) => {
              progress.stepStart(stepId, titlesByStepId.get(stepId));
              try {
                const result = await runAttemptUnlocked(runId, stepId, options, workspace.workspacePath);
                const runStatus = getRunStatusSummary(workspace.workspacePath, runId).latest[0]?.currentStatus;
                progress.stepDone(stepId, result, runStatus);

                return result;
              } catch (error) {
                progress.stepFailed(stepId, error);
                throw error;
              }
            },
          });
          stoppedStatus = scheduled.stoppedStatus;
          stoppedStepId = scheduled.stoppedStepId;

          return;
        }

        const startIndex = opts.fromStep ? taskGraph.steps.findIndex((step) => step.stepId === opts.fromStep) : 0;

        if (startIndex < 0) {
          throw new Error(`Step not found: ${opts.fromStep}`);
        }

        const result = await runSequentialSteps({
          cwd: workspace.workspacePath,
          runId,
          startIndex,
          taskGraphSteps: taskGraph.steps,
          attemptOptions,
          opts,
          progress,
        });
        stoppedStatus = result.stoppedStatus;
        stoppedStepId = result.stoppedStepId;
      },
    );
  } finally {
    progress.stopAll();
  }

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
