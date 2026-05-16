import { existsSync, readFileSync } from "fs";
import path from "path";
import { BudgetProfile } from "@kiwi/contracts";
import { ensureRunLayout, resolveRunArtifactPath } from "./run-store";
import { appendJsonLine, writeJsonSafely } from "./storage/json-io";

export const AuditEventTypes = {
  PlannerProviderSelected: "planner_provider_selected",
  PlannerRetry: "planner_retry",
  PlannerValidationFailed: "planner_validation_failed",
  PlannerSucceeded: "planner_succeeded",
  PlannerFailed: "planner_failed",
  PromptVersionUsed: "prompt_version_used",
  ReviewerProviderSelected: "reviewer_provider_selected",
  ReviewerRetry: "reviewer_retry",
  ReviewerValidationFailed: "reviewer_validation_failed",
  ReviewerSucceeded: "reviewer_succeeded",
  ReviewerFailed: "reviewer_failed",
  SchedulerRoutingDecided: "scheduler_routing_decided",
  SchedulerBlocked: "scheduler_blocked",
  ProviderPreferenceApplied: "provider_preference_applied",
  ExecutorModelSelected: "executor_model_selected",
  ContextPackageCreated: "context_package_created",
  StepAttemptStarted: "step_attempt_started",
  StepAttemptFailed: "step_attempt_failed",
  RunnerAttemptCompleted: "runner_attempt_completed",
  RunnerAttemptFailed: "runner_attempt_failed",
  StepAttemptReviewed: "step_attempt_reviewed",
  StepAttemptNextAction: "step_attempt_next_action",
  ApprovalDecisionRecorded: "approval_decision_recorded",
  RunFinalized: "run_finalized",
  RunStatusUpdated: "run_status_updated",
  RunLockAcquired: "run_lock_acquired",
  RunLockReleased: "run_lock_released",
  RunLockBusy: "run_lock_busy",
  ModelInvocationRecorded: "model_invocation_recorded",
  RunAuditSnapshotWritten: "run_audit_snapshot_written",
  EvidenceManifestWritten: "evidence_manifest_written",
  OperatorSnapshotWritten: "operator_snapshot_written",
  PrDraftPublished: "pr_draft_published",
  McpPreviewCreated: "mcp_preview_created",
  McpPreviewConsumed: "mcp_preview_consumed",
  GateCommandExecuted: "gate_command_executed",
  GateCommandBlocked: "gate_command_blocked",
  DiffPathBlocked: "diff_path_blocked",
  AttemptDiffApplied: "attempt_diff_applied",
  AttemptDiffApplyFailed: "attempt_diff_apply_failed",
  WorktreeCreated: "worktree_created",
  WorktreeRemoved: "worktree_removed",
  WorktreeRemoveFailed: "worktree_remove_failed",
  WorktreeOrphanReaped: "worktree_orphan_reaped",
  ReplanSucceeded: "replan_succeeded",
  ReplanFailed: "replan_failed",
  FixStepInjected: "fix_step_injected",
} as const;

export type AuditEventType = (typeof AuditEventTypes)[keyof typeof AuditEventTypes];

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

export function appendAuditEvent(cwd: string, event: AuditEvent): void {
  appendJsonLine(auditLogPath(cwd), event);
}

export function readAuditEvents(cwd: string, runId?: string): AuditEvent[] {
  const target = auditLogPath(cwd);

  if (!existsSync(target)) {
    return [];
  }

  const lines = readFileSync(target, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const events = lines.map((line) => JSON.parse(line) as AuditEvent);

  if (!runId) {
    return events;
  }

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
