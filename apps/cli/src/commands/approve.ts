import chalk from "chalk";
import {
  latestAttemptByStep,
  listStepAttemptEvidence,
  readJson,
  recordApprovalDecision,
  resolveRunArtifactPath,
  withRunLock,
} from "@kiwi/core";
import { ContractValues } from "@kiwi/contracts";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";

interface ApproveOptions extends CliWorkspaceOptions {
  reason?: string;
  approvedBy?: string;
  now?: Date;
}

function approvalRequiredFilesForAttempt(params: {
  cwd: string;
  runId: string;
  evidence: ReturnType<typeof listStepAttemptEvidence>[number];
}): string[] {
  const files = new Set<string>();

  for (const gate of params.evidence.gateResults) {
    if (gate.gateType !== "forbidden_file_checks" || gate.status !== ContractValues.Blocked) {
      continue;
    }
    for (const ref of gate.evidenceRefs) {
      const report = readJson(resolveRunArtifactPath(params.runId, ref, params.cwd)) as {
        approvalRequiredFiles?: unknown;
      };

      if (!Array.isArray(report.approvalRequiredFiles)) {
        continue;
      }
      for (const file of report.approvalRequiredFiles) {
        if (typeof file === "string" && file.length > 0) {
          files.add(file);
        }
      }
    }
  }

  return Array.from(files).sort();
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
