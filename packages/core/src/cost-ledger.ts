import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { BudgetProfile } from "@kiwi/contracts";
import { ensureRunLayout, resolveRunArtifactPath } from "./run-store";

export type AuditEventType =
  | "planner_provider_selected"
  | "planner_retry"
  | "planner_validation_failed"
  | "planner_succeeded"
  | "planner_failed"
  | "reviewer_provider_selected"
  | "reviewer_retry"
  | "reviewer_validation_failed"
  | "reviewer_succeeded"
  | "reviewer_failed"
  | "scheduler_routing_decided"
  | "scheduler_blocked"
  | "context_package_created"
  | "step_attempt_started"
  | "runner_attempt_completed"
  | "runner_attempt_failed"
  | "step_attempt_reviewed"
  | "step_attempt_next_action"
  | "approval_decision_recorded"
  | "run_finalized"
  | "run_status_updated"
  | "run_lock_acquired"
  | "run_lock_released"
  | "run_lock_busy"
  | "model_invocation_recorded"
  | "run_audit_snapshot_written"
  | "evidence_manifest_written"
  | "operator_snapshot_written"
  | "pr_draft_published"
  | "a2a_runtime_event"
  | "gate_command_executed"
  | "gate_command_blocked"
  | "diff_path_blocked"
  | "worktree_created"
  | "worktree_removed"
  | "worktree_remove_failed"
  | "worktree_orphan_reaped";

export interface AuditEvent {
  eventType: AuditEventType;
  runId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface PlannerCostReport {
  schemaVersion: "1";
  runId: string;
  plannerModelId: string;
  providerName: string;
  budgetProfile: BudgetProfile;
  budgetRemainingUsdEstimate: number | null;
  attemptsUsed: number;
  invalidAttempts: number;
  modelUsage: {
    inputTokens: number;
    outputTokens: number;
  };
  cost: {
    estimatedUsd: number;
    currency: "USD";
  };
  createdAt: string;
}

function auditLogPath(cwd: string): string {
  return path.join(cwd, ".kiwi", "logs", "audit.log");
}

function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

export function appendAuditEvent(cwd: string, event: AuditEvent): void {
  const target = auditLogPath(cwd);
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify(event)}\n`, "utf-8");
}

export function readAuditEvents(cwd: string, runId?: string): AuditEvent[] {
  const target = auditLogPath(cwd);
  if (!existsSync(target)) return [];

  const lines = readFileSync(target, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const events = lines.map((line) => JSON.parse(line) as AuditEvent);
  if (!runId) return events;
  return events.filter((event) => event.runId === runId);
}

export function writePlannerCostReport(cwd: string, runId: string, report: PlannerCostReport): void {
  ensureRunLayout(runId, cwd);
  const target = resolveRunArtifactPath(runId, "plan/cost-report.json", cwd);
  writeJsonSafely(target, report);
}

export function loadPlannerCostReport(cwd: string, runId: string): PlannerCostReport {
  const target = resolveRunArtifactPath(runId, "plan/cost-report.json", cwd);
  return JSON.parse(readFileSync(target, "utf-8")) as PlannerCostReport;
}
