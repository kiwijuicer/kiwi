import {
  approvalRequiredFilesForAttempt,
  getRunStatusSummary,
  latestAttemptByStep,
  listStepAttemptEvidence,
  recordApprovalDecision,
} from "@kiwi/core";
import { ContractValues } from "@kiwi/contracts";
import {
  applyRunDiff,
  assertDirectExecutionSafe,
  buildRunDiff,
  DirectExecutionUnsafeError,
  finalizeRun,
} from "@kiwi/runtime";
import {
  buildRunActivityTimeline,
  buildRunCompletionSummary,
  buildRunExplanation,
  writeEvidenceManifest,
  writeOperatorSnapshot,
} from "@kiwi/ops";
import { nextTool } from "./next-action.js";
import { withOperatorCard } from "../ux/operator-card.js";
import { publishPrDraftTool } from "./publish.js";
import { getMcpServerServices } from "../services.js";
import { ToolActionRequiredError } from "./errors.js";
import type { ToolCallOptions } from "./helpers.js";
import { consumeMcpPreviewToken, normalizePreviewInput, validateMcpPreviewToken } from "./preview-tokens.js";
import { mutationScope, safeReadOnlyToolCalls, toolCall } from "../ux/index.js";

function services(): ReturnType<typeof getMcpServerServices> {
  return getMcpServerServices();
}

interface CoreToolHandlers {
  previewRunTool(args: Record<string, unknown>, cwd: string): unknown;
  runTool(args: Record<string, unknown>, cwd: string, options: ToolCallOptions): Promise<unknown>;
  runStepTool(args: Record<string, unknown>, cwd: string, options: ToolCallOptions): Promise<unknown>;
}

interface CoreToolDispatchParams {
  name: string;
  args: Record<string, unknown>;
  cwd: string;
  workspacePath: string;
  repoPath: string | null;
  options: ToolCallOptions;
  handlers: CoreToolHandlers;
}

function approvalValidationError(params: {
  workspacePath: string;
  runId: string;
  reason: string;
}): ToolActionRequiredError {
  return new ToolActionRequiredError(`Cannot record approval: ${params.reason}`, {
    category: "action_required",
    recovery: {
      reason: params.reason,
      recommendedToolCall: toolCall("kiwi_next", { workspacePath: params.workspacePath, runId: params.runId }),
      safeAlternatives: safeReadOnlyToolCalls({ workspacePath: params.workspacePath, runId: params.runId }),
      userMessage: "Inspect the current run state and approve only the latest blocked attempt.",
    },
  });
}

function recordMcpApproval(args: Record<string, unknown>, workspacePath: string): unknown {
  const runId = String(args.runId ?? "");
  const attemptId = String(args.attemptId ?? "");
  const attempts = listStepAttemptEvidence(workspacePath, runId);
  const evidence = attempts.find((entry) => entry.attemptId === attemptId);

  if (!evidence) {
    throw approvalValidationError({ workspacePath, runId, reason: `attempt not found: ${attemptId}` });
  }
  const latestForStep = latestAttemptByStep(attempts).get(evidence.stepId);

  if (latestForStep?.attemptId !== attemptId) {
    throw approvalValidationError({
      workspacePath,
      runId,
      reason: `attempt ${attemptId} is not the latest attempt for ${evidence.stepId}`,
    });
  }
  if (evidence.attempt.status !== ContractValues.Blocked) {
    throw approvalValidationError({ workspacePath, runId, reason: `attempt ${attemptId} is not blocked` });
  }
  const approvalRequiredFiles = approvalRequiredFilesForAttempt({ cwd: workspacePath, runId, evidence });

  if (approvalRequiredFiles.length === 0) {
    throw approvalValidationError({
      workspacePath,
      runId,
      reason: `attempt ${attemptId} has no approval-required file evidence`,
    });
  }

  return recordApprovalDecision({
    cwd: workspacePath,
    runId,
    stepId: evidence.stepId,
    sourceAttemptId: attemptId,
    approvalRequiredFiles,
    reason: String(args.reason ?? "Approved through MCP"),
    approvedBy: String(args.approvedBy),
  });
}

interface DispatchContext extends CoreToolDispatchParams {
  runId: string;
}

function statusTool(context: DispatchContext): unknown {
  const status = getRunStatusSummary(
    context.workspacePath,
    typeof context.args.runId === "string" ? context.args.runId : undefined,
  );

  return typeof context.args.runId === "string"
    ? withOperatorCard(
        {
          schemaVersion: "2",
          kind: "run_status",
          status,
          activityTimeline: buildRunActivityTimeline({ cwd: context.workspacePath, runId: context.args.runId }),
        },
        { cwd: context.workspacePath, runId: context.args.runId, lastAction: "kiwi_status" },
      )
    : { schemaVersion: "2", kind: "run_status_list", status };
}

function diffTool(context: DispatchContext): unknown {
  return withOperatorCard(
    {
      schemaVersion: "2",
      kind: "run_diff",
      diff: buildRunDiff({
        cwd: context.workspacePath,
        runId: context.runId,
        ...(typeof context.args.stepId === "string" ? { stepId: context.args.stepId } : {}),
        ...(context.args.all === true ? { allAttempts: true } : {}),
      }),
    },
    { cwd: context.workspacePath, runId: context.runId, lastAction: "kiwi_diff" },
  );
}

function assertMcpApplyTargetSafe(params: { workspacePath: string; repoPath: string; runId: string }): void {
  try {
    assertDirectExecutionSafe(params.repoPath);
  } catch (error) {
    if (!(error instanceof DirectExecutionUnsafeError)) {
      throw error;
    }
    throw new ToolActionRequiredError(`Cannot apply patch safely: ${error.message}`, {
      category: "action_required",
      recovery: {
        reason: error.reasons.join("; "),
        recommendedToolCall: toolCall("kiwi_doctor", {
          workspacePath: params.workspacePath,
          repoPath: params.repoPath,
        }),
        safeAlternatives: safeReadOnlyToolCalls({
          workspacePath: params.workspacePath,
          repoPath: params.repoPath,
          runId: params.runId,
        }),
        userMessage: "Patch apply is unsafe. Switch away from main/master and clean the repo before applying.",
      },
    });
  }
}

function applyTool(context: DispatchContext): Promise<unknown> {
  return services().core.locks.withLock(
    { cwd: context.workspacePath, runId: context.runId, operation: "mcp_apply" },
    () => {
      const stepId = typeof context.args.stepId === "string" ? context.args.stepId : undefined;
      const previewRecord = validateMcpPreviewToken({
        cwd: context.workspacePath,
        runId: context.runId,
        previewToken: typeof context.args.previewToken === "string" ? context.args.previewToken : undefined,
        ...(stepId ? { stepId } : { previewInput: normalizePreviewInput({}) }),
      });

      assertMcpApplyTargetSafe({
        workspacePath: context.workspacePath,
        repoPath: previewRecord.repoPath,
        runId: context.runId,
      });
      consumeMcpPreviewToken({
        cwd: context.workspacePath,
        runId: context.runId,
        record: previewRecord,
        ...(stepId ? { stepId } : {}),
      });

      return withOperatorCard(
        {
          schemaVersion: "2",
          kind: "patch_apply_result",
          apply: applyRunDiff({
            cwd: context.workspacePath,
            runId: context.runId,
            ...(stepId ? { stepId } : {}),
          }),
        },
        {
          cwd: context.workspacePath,
          runId: context.runId,
          lastAction: "kiwi_apply",
          mutationScope: mutationScope({
            riskLabel: "APPLIES_PATCH",
            workspacePath: context.workspacePath,
            repoPath: context.repoPath,
            executionMode: null,
          }),
        },
      );
    },
  );
}

function finalizeTool(context: DispatchContext): Promise<unknown> {
  return services().core.locks.withLock(
    { cwd: context.workspacePath, runId: context.runId, operation: "mcp_finalize" },
    async () => {
      context.options.onProgress?.(`finalize started runId=${context.runId}`, 0);
      const finalized = await finalizeRun({ cwd: context.workspacePath, runId: context.runId });
      context.options.onProgress?.(`finalize completed runId=${context.runId}`, 100);

      return withOperatorCard(
        {
          schemaVersion: "2",
          kind: "run_finalization_result",
          ...finalized,
          summary: buildRunCompletionSummary({ cwd: context.workspacePath, runId: context.runId }),
        },
        {
          cwd: context.workspacePath,
          runId: context.runId,
          lastAction: "kiwi_finalize",
          mutationScope: mutationScope({
            riskLabel: "WRITES_RUN_ARTIFACTS",
            workspacePath: context.workspacePath,
            repoPath: context.repoPath,
            executionMode: null,
          }),
        },
      );
    },
  );
}

function costTool(context: DispatchContext): unknown {
  return withOperatorCard(
    {
      schemaVersion: "2",
      kind: "run_cost",
      summary: buildRunCompletionSummary({ cwd: context.workspacePath, runId: context.runId }),
    },
    {
      cwd: context.workspacePath,
      runId: context.runId,
      lastAction: "kiwi_cost",
    },
  );
}

function explainTool(context: DispatchContext): unknown {
  return withOperatorCard(
    {
      schemaVersion: "2",
      kind: "run_explanation",
      explanation: buildRunExplanation({ cwd: context.workspacePath, runId: context.runId }),
    },
    {
      cwd: context.workspacePath,
      runId: context.runId,
      lastAction: "kiwi_explain",
    },
  );
}

function requestApprovalTool(context: DispatchContext): unknown {
  return services().core.locks.withLock(
    {
      cwd: context.workspacePath,
      runId: context.runId,
      operation: `mcp_approval:${String(context.args.attemptId ?? "")}`,
    },
    () =>
      withOperatorCard(
        {
          schemaVersion: "2",
          kind: "approval_result",
          approval: recordMcpApproval(context.args, context.workspacePath),
        },
        {
          cwd: context.workspacePath,
          runId: context.runId,
          lastAction: "kiwi_request_approval",
          mutationScope: mutationScope({
            riskLabel: "WRITES_RUN_ARTIFACTS",
            workspacePath: context.workspacePath,
            repoPath: context.repoPath,
            executionMode: null,
          }),
        },
      ),
  );
}

function evidenceManifestTool(context: DispatchContext): unknown {
  return services().core.locks.withLock(
    { cwd: context.workspacePath, runId: context.runId, operation: "mcp_evidence_manifest" },
    () =>
      withOperatorCard(
        {
          schemaVersion: "2",
          kind: "evidence_manifest_result",
          manifest: writeEvidenceManifest({ cwd: context.workspacePath, runId: context.runId }),
        },
        {
          cwd: context.workspacePath,
          runId: context.runId,
          lastAction: "kiwi_evidence_manifest",
          mutationScope: mutationScope({
            riskLabel: "WRITES_RUN_ARTIFACTS",
            workspacePath: context.workspacePath,
            repoPath: context.repoPath,
            executionMode: null,
          }),
        },
      ),
  );
}

function operatorSnapshotTool(context: DispatchContext): unknown {
  return services().core.locks.withLock(
    { cwd: context.workspacePath, runId: context.runId, operation: "mcp_operator_snapshot" },
    () =>
      withOperatorCard(
        {
          schemaVersion: "2",
          kind: "operator_snapshot_result",
          snapshot: writeOperatorSnapshot({ cwd: context.workspacePath, runId: context.runId }),
        },
        {
          cwd: context.workspacePath,
          runId: context.runId,
          lastAction: "kiwi_operator_snapshot",
          mutationScope: mutationScope({
            riskLabel: "WRITES_RUN_ARTIFACTS",
            workspacePath: context.workspacePath,
            repoPath: context.repoPath,
            executionMode: null,
          }),
        },
      ),
  );
}

function publishPrDraftMcpTool(context: DispatchContext): Promise<unknown> {
  context.options.onProgress?.(`publish pr draft started runId=${context.runId}`, 0);

  return Promise.resolve(publishPrDraftTool(context.args, context.workspacePath)).then((result) => {
    context.options.onProgress?.(`publish pr draft completed runId=${context.runId}`, 100);
    const payload = typeof result === "object" && result !== null && !Array.isArray(result) ? result : { result };

    return withOperatorCard(
      { schemaVersion: "2", kind: "pr_draft_publish_result", publish: payload },
      {
        cwd: context.workspacePath,
        runId: context.runId,
        lastAction: "kiwi_publish_pr_draft",
        mutationScope: mutationScope({
          riskLabel: "PUSHES_BRANCH",
          workspacePath: context.workspacePath,
          repoPath: context.repoPath,
          executionMode: null,
        }),
      },
    );
  });
}

export function callCoreTool(params: CoreToolDispatchParams): Promise<unknown> | unknown | undefined {
  const context: DispatchContext = { ...params, runId: String(params.args.runId ?? "") };

  switch (params.name) {
    case "kiwi_status":
      return statusTool(context);
    case "kiwi_preview_run":
      return context.handlers.previewRunTool(context.args, context.cwd);
    case "kiwi_run":
      return context.handlers.runTool(context.args, context.cwd, context.options);
    case "kiwi_run_step":
      return context.handlers.runStepTool(context.args, context.cwd, context.options);
    case "kiwi_diff":
      return diffTool(context);
    case "kiwi_apply":
      return applyTool(context);
    case "kiwi_finalize":
      return finalizeTool(context);
    case "kiwi_cost":
      return costTool(context);
    case "kiwi_explain":
      return explainTool(context);
    case "kiwi_next":
      return nextTool(context.args, context.cwd);
    case "kiwi_request_approval":
      return requestApprovalTool(context);
    case "kiwi_evidence_manifest":
      return evidenceManifestTool(context);
    case "kiwi_operator_snapshot":
      return operatorSnapshotTool(context);
    case "kiwi_publish_pr_draft":
      return publishPrDraftMcpTool(context);
    default:
      return undefined;
  }
}
