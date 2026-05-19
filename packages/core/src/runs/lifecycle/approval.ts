import { existsSync, readdirSync } from "fs";
import path from "path";
import { ApprovalDecision, ApprovalDecisionSchema, ContractValues, GateTypes } from "@kiwi/contracts";
import { appendAuditEvent } from "../../ledger/cost-ledger.js";
import { ensureRunLayout, resolveRunArtifactPath } from "../store.js";
import { readJson, writeJsonSafely } from "../../storage/json-io.js";
import type { StepAttemptEvidence } from "./evidence-collection.js";

export function approvalRequiredFilesForAttempt(params: {
  cwd: string;
  runId: string;
  evidence: StepAttemptEvidence;
}): string[] {
  const files = new Set<string>();

  for (const gate of params.evidence.gateResults) {
    if (gate.gateType !== GateTypes.ForbiddenFileChecks || gate.status !== ContractValues.Blocked) {
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

export function recordApprovalDecision(params: {
  cwd: string;
  runId: string;
  stepId: string;
  sourceAttemptId: string;
  approvalRequiredFiles: string[];
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
    stepId: params.stepId,
    sourceAttemptId: params.sourceAttemptId,
    approvalRequiredFiles: params.approvalRequiredFiles,
    state: params.state ?? "auto",
    reason: params.reason,
    approvedBy: params.approvedBy ?? "local-operator",
    createdAt: now.toISOString(),
  });
  const ref = `approvals/${params.sourceAttemptId}.json`;
  writeJsonSafely(resolveRunArtifactPath(params.runId, ref, params.cwd), decision);
  appendAuditEvent(params.cwd, {
    eventType: "approval_decision_recorded",
    runId: params.runId,
    timestamp: decision.createdAt,
    payload: {
      stepId: params.stepId,
      sourceAttemptId: params.sourceAttemptId,
      state: decision.state,
      approvedBy: decision.approvedBy,
      approvalRequiredFiles: decision.approvalRequiredFiles,
    },
  });

  return decision;
}

export function loadApprovalDecision(params: {
  cwd: string;
  runId: string;
  sourceAttemptId: string;
}): ApprovalDecision | null {
  const target = resolveRunArtifactPath(params.runId, `approvals/${params.sourceAttemptId}.json`, params.cwd);

  if (!existsSync(target)) {
    return null;
  }

  return ApprovalDecisionSchema.parse(readJson(target));
}

export function loadLatestApprovalDecisionForStep(params: {
  cwd: string;
  runId: string;
  stepId: string;
}): ApprovalDecision | null {
  const approvalsDir = resolveRunArtifactPath(params.runId, "approvals", params.cwd);

  if (!existsSync(approvalsDir)) {
    return null;
  }
  const approvals = readdirSync(approvalsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      try {
        return ApprovalDecisionSchema.parse(readJson(path.join(approvalsDir, entry.name)));
      } catch {
        return null;
      }
    })
    .filter((entry): entry is ApprovalDecision => entry !== null && entry.stepId === params.stepId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return approvals[0] ?? null;
}
