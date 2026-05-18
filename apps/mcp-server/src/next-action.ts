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
import { getMcpServerServices } from "./services";
import { isBlockedApproverIdentity } from "./tool-input-schemas";
import { safeReadOnlyToolCalls, toolCall, type McpNextAction, mutationScope, workspaceToolArgs } from "./ux";
import { workspaceArgs } from "./workspace";

function hasArtifact(cwd: string, runId: string, ref: string): boolean {
  return existsSync(resolveRunArtifactPath(runId, ref, cwd));
}

interface NextActionDecision {
  nextAction: McpNextAction;
  blockedBy: string[];
}

interface NextActionContext {
  workspacePath: string;
  runId: string;
  baseArgs: Record<string, unknown>;
  previewArgs: Record<string, unknown>;
  validPreview: {
    token: string;
    previewInput: ReturnType<typeof normalizePreviewInput>;
  } | null;
  validPreviewBlockedBy: string[];
}

function missingRunAction(context: NextActionContext): NextActionDecision {
  return {
    nextAction: {
      recommendedToolCall: toolCall("kiwi_doctor", context.baseArgs),
      whyThisTool: "The run is missing or cannot be resolved.",
      requiresUserConfirmation: false,
      expectedMutation: "READ_ONLY",
      expectedAfter: "Inspect workspace readiness, then create a new plan if needed.",
    },
    blockedBy: [],
  };
}

function runnableRunAction(context: NextActionContext): NextActionDecision {
  if (context.validPreview) {
    if (context.validPreviewBlockedBy.length > 0) {
      return {
        nextAction: {
          recommendedToolCall: toolCall("kiwi_preview_run", context.previewArgs),
          whyThisTool: "The latest preview is blocked; inspect the preview decision before mutating.",
          requiresUserConfirmation: false,
          expectedMutation: "WRITES_RUN_ARTIFACTS",
          expectedAfter: "Show blocked steps and fix routing, budget, or runner availability before running.",
        },
        blockedBy: context.validPreviewBlockedBy,
      };
    }

    return {
      nextAction: {
        recommendedToolCall: toolCall("kiwi_run", {
          ...context.baseArgs,
          ...previewInputToolArgs(context.validPreview.previewInput),
          previewToken: context.validPreview.token,
        }),
        whyThisTool: "A fresh previewToken matches the current TaskGraph, policy, HEAD, dirty state, and run options.",
        requiresUserConfirmation: true,
        expectedMutation: "MUTATES_WORKTREE",
        expectedAfter: "Run execution starts; inspect progress notifications and the final operatorCard.",
      },
      blockedBy: [],
    };
  }

  return {
    nextAction: {
      recommendedToolCall: toolCall("kiwi_preview_run", context.previewArgs),
      whyThisTool: "Mutating MCP execution requires a fresh previewToken before kiwi_run or kiwi_run_step.",
      requiresUserConfirmation: false,
      expectedMutation: "WRITES_RUN_ARTIFACTS",
      expectedAfter: "Show the preview decision card to the user before running.",
    },
    blockedBy: [],
  };
}

function needsApprovalAction(context: NextActionContext): NextActionDecision {
  const blockedAttempt = Array.from(
    latestAttemptByStep(listStepAttemptEvidence(context.workspacePath, context.runId)).values(),
  ).find((entry) => entry.attempt.status === ContractValues.Blocked);
  const approval = blockedAttempt
    ? loadLatestApprovalDecisionForStep({
        cwd: context.workspacePath,
        runId: context.runId,
        stepId: blockedAttempt.stepId,
      })
    : null;

  if (!blockedAttempt) {
    return {
      nextAction: {
        recommendedToolCall: toolCall("kiwi_status", context.baseArgs),
        whyThisTool:
          "Run status is needs_approval but no blocked attempt is recorded; inspect run evidence before mutating.",
        requiresUserConfirmation: false,
        expectedMutation: "READ_ONLY",
        expectedAfter:
          "Re-plan or inspect attempt evidence; do not call kiwi_request_approval without a blocked attempt.",
      },
      blockedBy: ["run reports needs_approval but no blocked attempt was found"],
    };
  }
  const attemptId = blockedAttempt.attemptId;

  if (approval?.sourceAttemptId === attemptId) {
    return {
      nextAction: {
        recommendedToolCall: toolCall("kiwi_preview_run", {
          ...context.baseArgs,
          fromStep: blockedAttempt.stepId,
        }),
        whyThisTool: "Approval evidence matches the latest blocked attempt; preview execution from that step.",
        requiresUserConfirmation: false,
        expectedMutation: "WRITES_RUN_ARTIFACTS",
        expectedAfter: "Show the preview decision card to the user before re-running from the approved step.",
      },
      blockedBy: [`attempt ${attemptId} needs explicit approval`],
    };
  }
  const approvedBy = configuredApprovedBy();

  return {
    nextAction: {
      recommendedToolCall: approvedBy
        ? toolCall("kiwi_request_approval", {
            ...context.baseArgs,
            attemptId,
            approvedBy,
          })
        : null,
      whyThisTool: approvedBy
        ? "The latest attempt is blocked on an explicit approval decision."
        : "The latest attempt needs approval, but no explicit approvedBy identity is configured.",
      requiresUserConfirmation: true,
      expectedMutation: "WRITES_RUN_ARTIFACTS",
      expectedAfter: approvedBy
        ? "Approval evidence is recorded; call kiwi_next again."
        : "Call kiwi_request_approval with runId, attemptId, and approvedBy after the user approves.",
    },
    blockedBy: [
      `attempt ${attemptId} needs explicit approval`,
      ...(approvedBy ? [] : ["approvedBy identity is required before kiwi_request_approval"]),
    ],
  };
}

function configuredApprovedBy(): string | null {
  const value = process.env.KIWI_MCP_APPROVED_BY?.trim();

  if (!value || isBlockedApproverIdentity(value)) {
    return null;
  }

  return value;
}

function blockedPreviewReasons(params: {
  workspacePath: string;
  runId: string;
  previewInput: ReturnType<typeof normalizePreviewInput>;
}): string[] {
  try {
    const preview = getMcpServerServices().runtime.execution.previews.build({
      cwd: params.workspacePath,
      runId: params.runId,
      ...(params.previewInput.fromStep ? { fromStep: params.previewInput.fromStep } : {}),
      maxConcurrency: params.previewInput.maxConcurrency,
    });

    return preview.steps
      .filter((step) => step.status === ContractValues.Blocked)
      .map((step) => `${step.stepId}${step.blockedReason ? `: ${step.blockedReason}` : ""}`);
  } catch (error) {
    return [`preview could not be rebuilt: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function failedRunAction(context: NextActionContext): NextActionDecision {
  return {
    nextAction: {
      recommendedToolCall: toolCall("kiwi_diff", context.baseArgs),
      whyThisTool: "The run failed; inspect persisted attempt evidence and diff before changing anything.",
      requiresUserConfirmation: false,
      expectedMutation: "READ_ONLY",
      expectedAfter: "Decide whether to fix, replan, or inspect artifacts.",
    },
    blockedBy: [],
  };
}

function completedRunAction(context: NextActionContext): NextActionDecision {
  if (!hasArtifact(context.workspacePath, context.runId, "final/final-verdict.json")) {
    return {
      nextAction: {
        recommendedToolCall: toolCall("kiwi_finalize", context.baseArgs),
        whyThisTool: "The run completed but final verdict and final summary are missing.",
        requiresUserConfirmation: false,
        expectedMutation: "WRITES_RUN_ARTIFACTS",
        expectedAfter: "Write final verdict and summary, then create evidence manifest.",
      },
      blockedBy: [],
    };
  }
  if (!hasArtifact(context.workspacePath, context.runId, "final/evidence-manifest.json")) {
    return {
      nextAction: {
        recommendedToolCall: toolCall("kiwi_evidence_manifest", context.baseArgs),
        whyThisTool: "Final verdict exists but the hashed evidence manifest is missing.",
        requiresUserConfirmation: false,
        expectedMutation: "WRITES_RUN_ARTIFACTS",
        expectedAfter: "Write evidence manifest, then refresh the operator snapshot.",
      },
      blockedBy: [],
    };
  }

  return {
    nextAction: {
      recommendedToolCall: toolCall("kiwi_operator_snapshot", context.baseArgs),
      whyThisTool: "Run evidence is ready; refresh the local operator HTML snapshot.",
      requiresUserConfirmation: false,
      expectedMutation: "WRITES_RUN_ARTIFACTS",
      expectedAfter: "Open or inspect the operator snapshot artifact.",
    },
    blockedBy: [],
  };
}

function resolveNextAction(status: string, context: NextActionContext): NextActionDecision {
  if (status === RunStatuses.Planned || status === ContractValues.Running) {
    return runnableRunAction(context);
  }
  if (status === RunStatuses.NeedsApproval) {
    return needsApprovalAction(context);
  }
  if (status === ContractValues.Failed) {
    return failedRunAction(context);
  }
  if (status === ContractValues.Completed) {
    return completedRunAction(context);
  }

  return missingRunAction(context);
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
  const validPreviewBlockedBy = validPreview
    ? blockedPreviewReasons({ workspacePath: workspace.workspacePath, runId, previewInput: validPreview.previewInput })
    : [];
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
  const { nextAction, blockedBy } = resolveNextAction(status, {
    workspacePath: workspace.workspacePath,
    runId,
    baseArgs,
    previewArgs,
    validPreview,
    validPreviewBlockedBy,
  });

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
