import { existsSync } from "fs";
import { ContractValues, RunStatuses } from "@kiwi/contracts";
import {
  getRunStatusSummary,
  latestAttemptByStep,
  listStepAttemptEvidence,
  loadLatestApprovalDecisionForStep,
  resolveRunArtifactPath,
} from "@kiwi/core";
import { buildOperatorCard } from "./operator-card";
import { latestValidPreviewToken, normalizePreviewInput, previewInputToolArgs } from "./preview-tokens";
import { safeReadOnlyToolCalls, toolCall, type McpNextAction, mutationScope, workspaceToolArgs } from "./ux";
import { workspaceArgs } from "./workspace";

function hasArtifact(cwd: string, runId: string, ref: string): boolean {
  return existsSync(resolveRunArtifactPath(runId, ref, cwd));
}

export function nextTool(args: Record<string, unknown>, cwd: string): unknown {
  const runId = String(args.runId ?? "");

  if (!runId) {
    throw new Error("kiwi_next requires runId");
  }
  const workspace = workspaceArgs(args, cwd, false);
  const previewInput = normalizePreviewInput({
    fromStep: typeof args.fromStep === "string" ? args.fromStep : undefined,
    maxConcurrency: typeof args.maxConcurrency === "number" ? args.maxConcurrency : undefined,
  });
  const latest = getRunStatusSummary(workspace.workspacePath, runId).latest[0];
  const status = latest?.currentStatus ?? "missing";
  const validPreview = latestValidPreviewToken({ cwd: workspace.workspacePath, runId, previewInput });
  const baseArgs = workspaceToolArgs({
    workspacePath: workspace.workspacePath,
    repoId: workspace.repo?.id,
    repoPath: workspace.repo?.path,
    runId,
  });
  const previewArgs = {
    ...baseArgs,
    ...previewInputToolArgs(previewInput),
  };
  let nextAction: McpNextAction = {
    recommendedToolCall: toolCall("kiwi_doctor", baseArgs),
    whyThisTool: "The run is missing or cannot be resolved.",
    requiresUserConfirmation: false,
    expectedMutation: "READ_ONLY",
    expectedAfter: "Inspect workspace readiness, then create a new plan if needed.",
  };
  let blockedBy: string[] = [];

  if (status === RunStatuses.Planned || status === ContractValues.Running) {
    if (validPreview) {
      nextAction = {
        recommendedToolCall: toolCall("kiwi_run", {
          ...baseArgs,
          ...previewInputToolArgs(validPreview.previewInput),
          previewToken: validPreview.token,
        }),
        whyThisTool: "A fresh previewToken matches the current TaskGraph, policy, HEAD, dirty state, and run options.",
        requiresUserConfirmation: true,
        expectedMutation: "MUTATES_WORKTREE",
        expectedAfter: "Run execution starts; inspect progress notifications and the final operatorCard.",
      };
    } else {
      nextAction = {
        recommendedToolCall: toolCall("kiwi_preview_run", previewArgs),
        whyThisTool: "Mutating MCP execution requires a fresh previewToken before kiwi_run or kiwi_run_step.",
        requiresUserConfirmation: false,
        expectedMutation: "WRITES_RUN_ARTIFACTS",
        expectedAfter: "Show the preview decision card to the user before running.",
      };
    }
  } else if (status === RunStatuses.NeedsApproval) {
    const blockedAttempt = Array.from(
      latestAttemptByStep(listStepAttemptEvidence(workspace.workspacePath, runId)).values(),
    ).find((entry) => entry.attempt.status === ContractValues.Blocked);
    const approval = blockedAttempt
      ? loadLatestApprovalDecisionForStep({
          cwd: workspace.workspacePath,
          runId,
          stepId: blockedAttempt.stepId,
        })
      : null;

    if (!blockedAttempt) {
      blockedBy = ["run reports needs_approval but no blocked attempt was found"];
      nextAction = {
        recommendedToolCall: toolCall("kiwi_status", baseArgs),
        whyThisTool:
          "Run status is needs_approval but no blocked attempt is recorded; inspect run evidence before mutating.",
        requiresUserConfirmation: false,
        expectedMutation: "READ_ONLY",
        expectedAfter: "Re-plan or inspect attempt evidence; do not call kiwi_request_approval without a blocked attempt.",
      };
    } else {
      const attemptId = blockedAttempt.attemptId;
      const approvalApplies = approval?.sourceAttemptId === attemptId;
      blockedBy = [`attempt ${attemptId} needs explicit approval`];
      if (approvalApplies) {
        nextAction = {
          recommendedToolCall: toolCall("kiwi_preview_run", {
            ...baseArgs,
            fromStep: blockedAttempt.stepId,
          }),
          whyThisTool: "Approval evidence matches the latest blocked attempt; preview execution from that step.",
          requiresUserConfirmation: false,
          expectedMutation: "WRITES_RUN_ARTIFACTS",
          expectedAfter: "Show the preview decision card to the user before re-running from the approved step.",
        };
      } else {
        nextAction = {
          recommendedToolCall: toolCall("kiwi_request_approval", {
            ...baseArgs,
            attemptId,
          }),
          whyThisTool: "The latest attempt is blocked on an explicit approval decision.",
          requiresUserConfirmation: true,
          expectedMutation: "WRITES_RUN_ARTIFACTS",
          expectedAfter: "Approval evidence is recorded; call kiwi_next again.",
        };
      }
    }
  } else if (status === ContractValues.Failed) {
    nextAction = {
      recommendedToolCall: toolCall("kiwi_diff", baseArgs),
      whyThisTool: "The run failed; inspect persisted attempt evidence and diff before changing anything.",
      requiresUserConfirmation: false,
      expectedMutation: "READ_ONLY",
      expectedAfter: "Decide whether to fix, replan, or inspect artifacts.",
    };
  } else if (status === ContractValues.Completed) {
    if (!hasArtifact(workspace.workspacePath, runId, "final/final-verdict.json")) {
      nextAction = {
        recommendedToolCall: toolCall("kiwi_finalize", baseArgs),
        whyThisTool: "The run completed but final verdict and final summary are missing.",
        requiresUserConfirmation: false,
        expectedMutation: "WRITES_RUN_ARTIFACTS",
        expectedAfter: "Write final verdict and summary, then create evidence manifest.",
      };
    } else if (!hasArtifact(workspace.workspacePath, runId, "final/evidence-manifest.json")) {
      nextAction = {
        recommendedToolCall: toolCall("kiwi_evidence_manifest", baseArgs),
        whyThisTool: "Final verdict exists but the hashed evidence manifest is missing.",
        requiresUserConfirmation: false,
        expectedMutation: "WRITES_RUN_ARTIFACTS",
        expectedAfter: "Write evidence manifest, then refresh the operator snapshot.",
      };
    } else {
      nextAction = {
        recommendedToolCall: toolCall("kiwi_operator_snapshot", baseArgs),
        whyThisTool: "Run evidence is ready; refresh the local operator HTML snapshot.",
        requiresUserConfirmation: false,
        expectedMutation: "WRITES_RUN_ARTIFACTS",
        expectedAfter: "Open or inspect the operator snapshot artifact.",
      };
    }
  }

  return {
    schemaVersion: "2",
    runId,
    currentState: status,
    nextAction,
    blockedBy,
    safeAlternatives: safeReadOnlyToolCalls({ workspacePath: workspace.workspacePath, runId }),
    previewResource: validPreview ? `kiwi://runs/${runId}/previews/${validPreview.token}` : null,
    operatorCard: buildOperatorCard({
      cwd: workspace.workspacePath,
      runId,
      lastAction: "kiwi_next",
      nextAction,
      blockedBy,
      mutationScope: mutationScope({
        riskLabel: nextAction.expectedMutation,
        workspacePath: workspace.workspacePath,
        repoPath: workspace.repo?.path ?? null,
        executionMode: null,
      }),
    }),
  };
}
