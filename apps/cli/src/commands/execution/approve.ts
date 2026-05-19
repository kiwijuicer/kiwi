import chalk from "chalk";
import {
  approvalRequiredFilesForAttempt,
  latestAttemptByStep,
  listStepAttemptEvidence,
  recordApprovalDecision,
  withRunLock,
} from "@kiwi/core";
import { ContractValues } from "@kiwi/contracts";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../../workspace/options.js";

interface ApproveOptions extends CliWorkspaceOptions {
  reason?: string;
  approvedBy?: string;
  now?: Date;
}

function approvalInput(params: {
  cwd: string;
  runId: string;
  attemptId: string;
  opts: ApproveOptions;
}): Parameters<typeof recordApprovalDecision>[0] {
  const attempts = listStepAttemptEvidence(params.cwd, params.runId);
  const evidence = attempts.find((entry) => entry.attemptId === params.attemptId);

  if (!evidence) {
    throw new Error(`Cannot record approval: attempt not found: ${params.attemptId}`);
  }
  const latestForStep = latestAttemptByStep(attempts).get(evidence.stepId);

  if (latestForStep?.attemptId !== params.attemptId) {
    throw new Error(
      `Cannot record approval: attempt ${params.attemptId} is not the latest attempt for ${evidence.stepId}`,
    );
  }
  if (evidence.attempt.status !== ContractValues.Blocked) {
    throw new Error(`Cannot record approval: attempt ${params.attemptId} is not blocked`);
  }
  const approvalRequiredFiles = approvalRequiredFilesForAttempt({
    cwd: params.cwd,
    runId: params.runId,
    evidence,
  });

  if (approvalRequiredFiles.length === 0) {
    throw new Error(`Cannot record approval: attempt ${params.attemptId} has no approval-required file evidence`);
  }
  const input: Parameters<typeof recordApprovalDecision>[0] = {
    cwd: params.cwd,
    runId: params.runId,
    stepId: evidence.stepId,
    sourceAttemptId: params.attemptId,
    approvalRequiredFiles,
    reason: params.opts.reason ?? "Approved by local operator",
  };

  if (params.opts.approvedBy) {
    input.approvedBy = params.opts.approvedBy;
  }
  if (params.opts.now) {
    input.now = params.opts.now;
  }

  return input;
}

export async function runApprove(
  runId: string,
  attemptId: string,
  opts: ApproveOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const decision = await withRunLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: `approve:${attemptId}`,
      now: opts.now,
    },
    () =>
      recordApprovalDecision(
        approvalInput({
          cwd: workspace.workspacePath,
          runId,
          attemptId,
          opts,
        }),
      ),
  );

  console.log(chalk.green("✓") + " Approval recorded");
  console.log(chalk.dim(`runId: ${runId}`));
  console.log(chalk.dim(`attemptId: ${attemptId}`));
  console.log(chalk.dim(`state: ${decision.state}`));
}
