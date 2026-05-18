import {
  getRunStatusSummary,
  latestAttemptByStep,
  listStepAttemptEvidence,
  readJson,
  recordApprovalDecision,
  resolveRunArtifactPath,
} from "@kiwi/core";
import { ContractValues } from "@kiwi/contracts";
import { applyRunDiff, buildRunDiff, finalizeRun } from "@kiwi/runtime";
import {
  buildRunCompletionSummary,
  buildRunExplanation,
  writeEvidenceManifest,
  writeOperatorSnapshot,
} from "@kiwi/ops";
import { nextTool } from "./next-action";
import { withOperatorCard } from "./operator-card";
import { publishPrDraftTool } from "./publish-tool";
import { getMcpServerServices } from "./services";
import { ToolActionRequiredError } from "./tool-errors";
import type { ToolCallOptions } from "./tool-helpers";
import { mutationScope, safeReadOnlyToolCalls, toolCall } from "./ux";

const mcpServices = getMcpServerServices();

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

function approvalRequiredFilesForAttempt(params: {
  workspacePath: string;
  runId: string;
  evidence: ReturnType<typeof listStepAttemptEvidence>[number];
}): string[] {
  const files = new Set<string>();

  for (const gate of params.evidence.gateResults) {
    if (gate.gateType !== "forbidden_file_checks" || gate.status !== ContractValues.Blocked) {
      continue;
    }
    for (const ref of gate.evidenceRefs) {
      const report = readJson(resolveRunArtifactPath(params.runId, ref, params.workspacePath)) as {
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
  const approvalRequiredFiles = approvalRequiredFilesForAttempt({ workspacePath, runId, evidence });

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
        { schemaVersion: "2", kind: "run_status", status },
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

function applyTool(context: DispatchContext): unknown {
  return withOperatorCard(
    {
      schemaVersion: "2",
      kind: "patch_apply_result",
      apply: applyRunDiff({
        cwd: context.workspacePath,
        runId: context.runId,
        ...(typeof context.args.stepId === "string" ? { stepId: context.args.stepId } : {}),
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
}

function finalizeTool(context: DispatchContext): unknown {
  return mcpServices.core.locks.withLock(
    { cwd: context.workspacePath, runId: context.runId, operation: "mcp_finalize" },
    () => {
      context.options.onProgress?.(`finalize started runId=${context.runId}`, 0);
      const finalized = finalizeRun({ cwd: context.workspacePath, runId: context.runId });
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
  return mcpServices.core.locks.withLock(
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
  return mcpServices.core.locks.withLock(
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
  return mcpServices.core.locks.withLock(
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
