import chalk from "chalk";
import {
  CorruptRunStatusEntry,
  getRunStatusSummary,
  loadTaskGraph,
  RunArtifactPaths,
  RunEditedFileEntry,
  RunAttemptStatusEntry,
  RunStatusEntry,
} from "@kiwi/core";
import { buildRunCompletionSummary } from "@kiwi/ops";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../../workspace/options.js";
import { formatSubPlanTreeLines } from "../planning/subplan-tree.js";

interface StatusOptions extends CliWorkspaceOptions {
  json?: boolean;
  verbose?: boolean;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function printAttemptStatuses(attempts: RunAttemptStatusEntry[]): void {
  if (attempts.length === 0) {
    return;
  }
  console.log(`  attempts:`);
  for (const attempt of attempts) {
    console.log(
      `    ${attempt.stepId}/${attempt.attemptId}  ${attempt.status}  gates:${attempt.gateStatus}  review:${attempt.reviewVerdict}  next:${attempt.nextAction}`,
    );
  }
}

function printArtifactPaths(paths: RunArtifactPaths): void {
  const ordered = [
    paths.runManifest,
    paths.initiative,
    paths.taskGraph,
    paths.finalSummary,
    paths.finalVerdict,
    paths.finalCostReport,
    paths.auditSnapshot,
    paths.evidenceManifest,
    paths.operatorSnapshot,
  ].filter((entry): entry is string => typeof entry === "string");

  console.log(`  artifacts:`);
  for (const artifactPath of ordered) {
    console.log(`    ${artifactPath}`);
  }
}

function printStepDetails(entry: RunStatusEntry): void {
  console.log(`  step_status:`);
  for (const step of entry.steps) {
    const attempt = step.latestAttemptId ? ` attempt:${step.latestAttemptId}` : "";
    const files = step.editedFiles.length > 0 ? ` files:${step.editedFiles.join(",")}` : "";
    console.log(`    ${step.stepId}  ${step.status}  ${step.title}${attempt}${files}`);
  }
  console.log(
    `  completed_steps: ${
      entry.completedSteps.length > 0 ? entry.completedSteps.map((step) => step.stepId).join(", ") : "none"
    }`,
  );
  console.log(
    `  remaining_steps: ${
      entry.remainingSteps.length > 0
        ? entry.remainingSteps.map((step) => `${step.stepId}:${step.status}`).join(", ")
        : "none"
    }`,
  );
}

function printEditedFiles(files: RunEditedFileEntry[]): void {
  console.log(`  edited_files:`);
  if (files.length === 0) {
    console.log(`    none`);

    return;
  }
  for (const file of files) {
    console.log(`    ${file.path}  ${file.stepId}/${file.attemptId}`);
  }
}

function printActiveStepActivity(entry: RunStatusEntry): void {
  console.log(`  active_activity:`);
  if (entry.activeStepActivity.length === 0) {
    console.log(`    none`);

    return;
  }
  for (const activity of entry.activeStepActivity) {
    const routing =
      activity.routingReason && activity.routingReason.length > 0 ? ` routing:${activity.routingReason.join(",")}` : "";
    const scheduler = activity.schedulerStatus ? ` scheduler:${activity.schedulerStatus}` : "";
    console.log(
      `    ${activity.stepId}/${activity.attemptId}  ${activity.status}  runner:${activity.runner}${scheduler}${routing}`,
    );
    console.log(`      started: ${activity.startedAt}`);
    console.log(`      context: ${activity.contextPackageRef}`);
  }
}

function printCorruptRuns(corrupt: CorruptRunStatusEntry[]): void {
  if (corrupt.length === 0) {
    return;
  }
  console.log(chalk.yellow(`corrupt runs skipped: ${corrupt.length}`));
  for (const entry of corrupt) {
    console.log(chalk.dim(`  ${entry.runId}: ${entry.error}`));
  }
}

function printSubPlanTree(runId: string, cwd: string): void {
  const lines = formatSubPlanTreeLines(loadTaskGraph(runId, cwd), "    ");

  if (lines.length === 0) {
    return;
  }
  console.log("  subplans:");
  for (const line of lines) {
    console.log(line);
  }
}

function printRunEntry(entry: RunStatusEntry, cwd: string): void {
  console.log(`${entry.runId}  ${entry.currentStatus}  ${entry.updatedAt}`);
  console.log(`  run_state: ${entry.currentStatus}`);
  if (entry.currentStatus !== entry.status) {
    console.log(`  manifest_status: ${entry.status}`);
  }
  console.log(`  title: ${entry.initiativeTitle}`);
  if (entry.repoId || entry.repoPath) {
    console.log(`  repo: ${entry.repoId ?? "repo"}${entry.repoPath ? ` (${entry.repoPath})` : ""}`);
  }
  console.log(`  plan: ${entry.currentPlanId}`);
  console.log(`  steps: ${entry.stepCount}`);
  printSubPlanTree(entry.runId, cwd);
  printStepDetails(entry);
  printEditedFiles(entry.editedFiles);
  printActiveStepActivity(entry);
  printAttemptStatuses(entry.attempts);
  printArtifactPaths(entry.artifactPaths);
}

function printCompactRunEntry(entry: RunStatusEntry, cwd: string): void {
  const summary = buildRunCompletionSummary({ cwd, runId: entry.runId });
  console.log(
    `${entry.runId}  ${entry.currentStatus}  ${formatUsd(summary.totalEstimatedCostUsd)}  ${summary.nextAction}`,
  );
}

export async function runStatus(cwd: string = process.cwd(), runId?: string, opts: StatusOptions = {}): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const summary = getRunStatusSummary(workspace.workspacePath, runId);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));

    return;
  }

  if (summary.latest.length === 0) {
    console.log(`runs: ${summary.total}`);
    printCorruptRuns(summary.corrupt);
    if (summary.corrupt.length === 0) {
      console.log(chalk.dim("no runs found"));
    }

    return;
  }

  if (!opts.verbose) {
    console.log("runId  status  cost  next-action");
    for (const entry of summary.latest) {
      printCompactRunEntry(entry, workspace.workspacePath);
    }
    printCorruptRuns(summary.corrupt);

    return;
  }

  console.log(chalk.bold("kiwi status"));
  console.log(`workspace: ${workspace.workspacePath}`);
  if (runId) {
    console.log(`selected_run: ${runId}`);
  }
  console.log(`runs: ${summary.total}`);
  console.log(`planned: ${summary.planned}`);
  console.log(`running: ${summary.running}`);
  console.log(`needs_approval: ${summary.needsApproval}`);
  console.log(`completed: ${summary.completed}`);
  console.log(`failed: ${summary.failed}`);
  console.log(`cancelled: ${summary.cancelled}`);
  console.log(`corrupt: ${summary.corrupt.length}`);
  console.log("");
  console.log(chalk.bold("latest runs:"));
  for (const entry of summary.latest) {
    printRunEntry(entry, workspace.workspacePath);
  }
  printCorruptRuns(summary.corrupt);
}
