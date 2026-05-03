import chalk from "chalk";
import { getRunStatusSummary } from "@ai-kiwi/core";

export async function runStatus(cwd: string = process.cwd()): Promise<void> {
  const summary = getRunStatusSummary(cwd);

  console.log(chalk.bold("ai-kiwi status"));
  console.log(`runs: ${summary.total}`);
  console.log(`planned: ${summary.planned}`);
  console.log(`running: ${summary.running}`);
  console.log(`needs_approval: ${summary.needsApproval}`);
  console.log(`completed: ${summary.completed}`);
  console.log(`failed: ${summary.failed}`);

  if (summary.latest.length === 0) {
    console.log(chalk.dim("no runs found"));
    return;
  }

  console.log("");
  console.log(chalk.bold("latest runs:"));
  for (const run of summary.latest) {
    console.log(`${run.runId}  ${run.status}  ${run.updatedAt}`);
  }
}
