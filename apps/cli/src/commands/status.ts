import chalk from "chalk";
import { getRunStatusSummary } from "@ai-kiwi/core";

export async function runStatus(cwd: string = process.cwd(), runId?: string): Promise<void> {
  const summary = getRunStatusSummary(cwd, runId);

  console.log(chalk.bold("ai-kiwi status"));
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
    console.log(`${entry.runId}  ${entry.status}  ${entry.updatedAt}`);
    console.log(`  title: ${entry.initiativeTitle}`);
    console.log(`  plan: ${entry.currentPlanId}`);
    console.log(`  steps: ${entry.stepCount}`);
    console.log(`  artifacts:`);
    console.log(`    ${entry.artifactPaths.runManifest}`);
    console.log(`    ${entry.artifactPaths.initiative}`);
    console.log(`    ${entry.artifactPaths.taskGraph}`);
  }
}
