import chalk from "chalk";
import { recordApprovalDecision } from "@ai-kiwi/core";

export interface ApproveOptions {
  reason?: string;
  approvedBy?: string;
  now?: Date;
}

export async function runApprove(
  runId: string,
  attemptId: string,
  opts: ApproveOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const input: Parameters<typeof recordApprovalDecision>[0] = {
    cwd,
    runId,
    attemptId,
    reason: opts.reason ?? "Approved by local operator",
  };
  if (opts.approvedBy) input.approvedBy = opts.approvedBy;
  if (opts.now) input.now = opts.now;
  const decision = recordApprovalDecision(input);

  console.log(chalk.green("✓") + " Approval recorded");
  console.log(chalk.dim(`runId: ${runId}`));
  console.log(chalk.dim(`attemptId: ${attemptId}`));
  console.log(chalk.dim(`state: ${decision.state}`));
}
