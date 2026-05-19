import chalk from "chalk";
import { resolveActiveRun, withRunLock } from "@kiwi/core";
import { recordFeedbackAndReplan } from "@kiwi/runtime";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../../workspace/options.js";

interface FeedbackOptions extends CliWorkspaceOptions {
  message: string;
  author?: string;
  targetStep?: string;
  targetAttempt?: string;
  json?: boolean;
}

function resolveFeedbackRunId(
  runId: string | undefined,
  opts: FeedbackOptions,
  cwd: string,
): { runId: string; cwd: string } {
  const workspace = resolveCliWorkspace(opts, cwd, false);

  if (runId) {
    return { runId, cwd: workspace.workspacePath };
  }
  const active = resolveActiveRun({
    cwd: workspace.workspacePath,
    ...(workspace.repo?.id ? { repoId: workspace.repo.id } : {}),
    ...(workspace.repo?.path ? { repoPath: workspace.repo.path } : {}),
  });

  if (!active) {
    throw new Error("No active kiwi run for this repo. Run `kiwi status` or `kiwi plan` first.");
  }

  return { runId: active.runId, cwd: workspace.workspacePath };
}

export async function runFeedback(
  runId: string | undefined,
  opts: FeedbackOptions,
  cwd: string = process.cwd(),
): Promise<void> {
  const target = resolveFeedbackRunId(runId, opts, cwd);

  const result = await withRunLock({ cwd: target.cwd, runId: target.runId, operation: "feedback" }, () =>
    recordFeedbackAndReplan({
      cwd: target.cwd,
      runId: target.runId,
      message: opts.message,
      source: "cli",
      ...(opts.author ? { author: opts.author } : {}),
      ...(opts.targetStep ? { targetStepId: opts.targetStep } : {}),
      ...(opts.targetAttempt ? { targetAttemptId: opts.targetAttempt } : {}),
      env: process.env,
    }),
  );

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));

    return;
  }

  console.log(`${chalk.green("✓")} feedback recorded and replanned`);
  console.log(chalk.dim(`runId: ${result.runId}`));
  console.log(chalk.dim(`feedback: ${result.feedbackRef}`));
  console.log(chalk.dim(`plan: ${result.taskGraphPath}`));
  if (result.resumeFromStepId) {
    console.log(chalk.dim(`next: kiwi run ${result.runId} --from-step ${result.resumeFromStepId}`));
  }
}
