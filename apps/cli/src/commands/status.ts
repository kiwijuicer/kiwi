import chalk from "chalk";
import { getRunStatusSummary, loadTaskGraph, RunArtifactPaths, RunAttemptStatusEntry, RunStatusEntry } from "@kiwi/core";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";
import { formatSubPlanTreeLines } from "./subplan-tree";

interface StatusOptions extends CliWorkspaceOptions {
  json?: boolean;
}

function printAttemptStatuses(attempts: RunAttemptStatusEntry[]): void {
  if (attempts.length === 0) return;
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

function printSubPlanTree(runId: string, cwd: string): void {
  const lines = formatSubPlanTreeLines(loadTaskGraph(runId, cwd), "    ");
  if (lines.length === 0) return;
  console.log("  subplans:");
  for (const line of lines) {
    console.log(line);
  }
}

function printRunEntry(entry: RunStatusEntry, cwd: string): void {
  console.log(`${entry.runId}  ${entry.status}  ${entry.updatedAt}`);
  console.log(`  title: ${entry.initiativeTitle}`);
  if (entry.repoId || entry.repoPath) {
    console.log(`  repo: ${entry.repoId ?? "repo"}${entry.repoPath ? ` (${entry.repoPath})` : ""}`);
  }
  console.log(`  plan: ${entry.currentPlanId}`);
  console.log(`  steps: ${entry.stepCount}`);
  printSubPlanTree(entry.runId, cwd);
  printAttemptStatuses(entry.attempts);
  printArtifactPaths(entry.artifactPaths);
}

export async function runStatus(cwd: string = process.cwd(), runId?: string, opts: StatusOptions = {}): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const summary = getRunStatusSummary(workspace.workspacePath, runId);
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
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

  if (summary.latest.length === 0) {
    console.log(chalk.dim("no runs found"));
    return;
  }

  console.log("");
  console.log(chalk.bold("latest runs:"));
  for (const entry of summary.latest) {
    printRunEntry(entry, workspace.workspacePath);
  }
}
