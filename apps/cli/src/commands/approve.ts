import chalk from "chalk";
import { recordApprovalDecision, withRunLock } from "@ai-kiwi/core";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";

export interface ApproveOptions extends CliWorkspaceOptions {
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
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const input: Parameters<typeof recordApprovalDecision>[0] = {
    cwd: workspace.workspacePath,
    runId,
    attemptId,
    reason: opts.reason ?? "Approved by local operator",
  };
  if (opts.approvedBy) input.approvedBy = opts.approvedBy;
  if (opts.now) input.now = opts.now;
  const decision = await withRunLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: `approve:${attemptId}`,
      now: opts.now,
    },
    () => recordApprovalDecision(input),
  );

  console.log(chalk.green("✓") + " Approval recorded");
  console.log(chalk.dim(`runId: ${runId}`));
  console.log(chalk.dim(`attemptId: ${attemptId}`));
  console.log(chalk.dim(`state: ${decision.state}`));
}
