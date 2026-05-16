import { existsSync } from "fs";
import { ContractValues, RunStatuses } from "@kiwi/contracts";
import { getRunStatusSummary, resolveRunArtifactPath } from "@kiwi/core";
import { buildOperatorCard } from "./operator-card";
import { latestValidPreviewToken, normalizePreviewInput } from "./preview-tokens";
import { workspaceArgs } from "./workspace";

type NextTool =
  | "kiwi_preview_run"
  | "kiwi_run"
  | "kiwi_request_approval"
  | "kiwi_diff"
  | "kiwi_finalize"
  | "kiwi_evidence_manifest"
  | "kiwi_operator_snapshot"
  | "kiwi_status";

function hasArtifact(cwd: string, runId: string, ref: string): boolean {
  return existsSync(resolveRunArtifactPath(runId, ref, cwd));
}

export function nextTool(args: Record<string, unknown>, cwd: string): unknown {
  const runId = String(args.runId ?? "");
  if (!runId) throw new Error("kiwi_next requires runId");
  const workspace = workspaceArgs(args, cwd, false);
  const previewInput = normalizePreviewInput({
    fromStep: typeof args.fromStep === "string" ? args.fromStep : undefined,
    maxConcurrency: typeof args.maxConcurrency === "number" ? args.maxConcurrency : undefined,
  });
  const latest = getRunStatusSummary(workspace.workspacePath, runId).latest[0];
  const status = latest?.currentStatus ?? "missing";
  const validPreview = latestValidPreviewToken({ cwd: workspace.workspacePath, runId, previewInput });
  let primaryNextTool: NextTool = "kiwi_status";
  let reason = "run is missing";
  let requiresUserConfirmation = false;

  if (status === RunStatuses.Planned || status === ContractValues.Running) {
    if (validPreview) {
      primaryNextTool = "kiwi_run";
      reason = "fresh preview token is available";
      requiresUserConfirmation = true;
    } else {
      primaryNextTool = "kiwi_preview_run";
      reason = "mutating MCP run requires a fresh preview token";
    }
  } else if (status === "needs_approval") {
    primaryNextTool = "kiwi_request_approval";
    reason = "latest attempt needs explicit approval";
    requiresUserConfirmation = true;
  } else if (status === ContractValues.Failed) {
    primaryNextTool = "kiwi_diff";
    reason = "run failed; inspect persisted attempt evidence and diff";
  } else if (status === ContractValues.Completed) {
    if (!hasArtifact(workspace.workspacePath, runId, "final/final-verdict.json")) {
      primaryNextTool = "kiwi_finalize";
      reason = "run completed but final verdict is missing";
    } else if (!hasArtifact(workspace.workspacePath, runId, "final/evidence-manifest.json")) {
      primaryNextTool = "kiwi_evidence_manifest";
      reason = "final verdict exists but evidence manifest is missing";
    } else {
      primaryNextTool = "kiwi_operator_snapshot";
      reason = "run evidence is ready; operator snapshot can be refreshed";
    }
  }

  return {
    runId,
    currentState: status,
    primaryNextTool,
    previewToken: validPreview?.token ?? null,
    requiresUserConfirmation,
    reason,
    safeReadOnlyAlternatives: ["kiwi_status", "kiwi_explain", "kiwi_diff", "kiwi_cost"],
    operatorCard: buildOperatorCard({ cwd: workspace.workspacePath, runId }),
  };
}
