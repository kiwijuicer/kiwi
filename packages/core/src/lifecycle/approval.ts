import { existsSync } from "fs";
import { ApprovalDecision, ApprovalDecisionSchema } from "@kiwi/contracts";
import { appendAuditEvent } from "../cost-ledger";
import { ensureRunLayout, resolveRunArtifactPath } from "../run-store";
import { readJson, writeJsonSafely } from "../storage/json-io";

export function recordApprovalDecision(params: {
  cwd: string;
  runId: string;
  attemptId: string;
  state?: ApprovalDecision["state"];
  reason: string;
  approvedBy?: string;
  now?: Date;
}): ApprovalDecision {
  ensureRunLayout(params.runId, params.cwd);
  const now = params.now ?? new Date();
  const decision = ApprovalDecisionSchema.parse({
    schemaVersion: "1",
    runId: params.runId,
    attemptId: params.attemptId,
    state: params.state ?? "auto",
    reason: params.reason,
    approvedBy: params.approvedBy ?? "local-operator",
    createdAt: now.toISOString(),
  });
  const ref = `approvals/${params.attemptId}.json`;
  writeJsonSafely(resolveRunArtifactPath(params.runId, ref, params.cwd), decision);
  appendAuditEvent(params.cwd, {
    eventType: "approval_decision_recorded",
    runId: params.runId,
    timestamp: decision.createdAt,
    payload: {
      attemptId: params.attemptId,
      state: decision.state,
      approvedBy: decision.approvedBy,
    },
  });
  return decision;
}

export function loadApprovalDecision(params: {
  cwd: string;
  runId: string;
  attemptId: string;
}): ApprovalDecision | null {
  const target = resolveRunArtifactPath(params.runId, `approvals/${params.attemptId}.json`, params.cwd);
  if (!existsSync(target)) return null;
  return ApprovalDecisionSchema.parse(readJson(target));
}
