import { ContractValues, StepAttemptStatuses, StepStatuses } from "@kiwi/contracts";

export const RunActivityStatuses = {
  Pending: StepAttemptStatuses.Pending,
  Running: ContractValues.Running,
  Completed: ContractValues.Completed,
  Failed: ContractValues.Failed,
  Blocked: ContractValues.Blocked,
  Skipped: StepStatuses.Skipped,
} as const;

export const RunActivityPhases = {
  Planning: "planning",
  Preview: "preview",
  Routing: "routing",
  Context: "context",
  Execution: "execution",
  Diff: "diff",
  Gate: "gate",
  Review: "review",
  Approval: "approval",
  Replan: "replan",
  Finalize: "finalize",
  Publish: "publish",
} as const;

export const ActivityTimelineChildModes = {
  All: "all",
  Focused: "focused",
} as const;

export type RunActivityStatus = (typeof RunActivityStatuses)[keyof typeof RunActivityStatuses];
export type RunActivityPhase = (typeof RunActivityPhases)[keyof typeof RunActivityPhases];
export type ActivityTimelineChildMode = (typeof ActivityTimelineChildModes)[keyof typeof ActivityTimelineChildModes];

export interface RunActivitySummary {
  total: number;
  completed: number;
  running: number;
  pending: number;
  failed: number;
  blocked: number;
}

export interface RunActivityTimeline {
  schemaVersion: "1";
  runId: string;
  generatedAt: string;
  summary: RunActivitySummary;
  activities: RunActivityEntry[];
}

export interface WorkspaceActivityTimeline {
  schemaVersion: "1";
  generatedAt: string;
  summary: RunActivitySummary;
  runs: Array<{ runId: string; status: string; updatedAt: string }>;
  activities: RunActivityEntry[];
}

export interface RunActivityEntry {
  activityId: string;
  parentActivityId?: string;
  runId: string;
  stepId?: string;
  attemptId?: string;
  phase: RunActivityPhase;
  title: string;
  status: RunActivityStatus;
  startedAt?: string;
  completedAt?: string | null;
  artifactRefs: string[];
  metadata?: Record<string, unknown>;
}

export interface ActivityTimelineRenderOptions {
  ascii?: boolean;
  includeChildren?: ActivityTimelineChildMode;
}

export interface ActivityInput {
  activityId: string;
  parentActivityId?: string | undefined;
  runId: string;
  stepId?: string | undefined;
  attemptId?: string | undefined;
  phase: RunActivityPhase;
  title: string;
  status: RunActivityStatus;
  startedAt?: string | undefined;
  completedAt?: string | null | undefined;
  artifactRefs?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export function compactRecord(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(input).filter(([, value]) => {
    if (value === null || value === undefined) {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return value !== "";
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function pushActivity(activities: RunActivityEntry[], input: ActivityInput): void {
  const entry: RunActivityEntry = {
    activityId: input.activityId,
    runId: input.runId,
    phase: input.phase,
    title: input.title,
    status: input.status,
    artifactRefs: input.artifactRefs ?? [],
  };

  if (input.parentActivityId) {
    entry.parentActivityId = input.parentActivityId;
  }
  if (input.stepId) {
    entry.stepId = input.stepId;
  }
  if (input.attemptId) {
    entry.attemptId = input.attemptId;
  }
  if (input.startedAt) {
    entry.startedAt = input.startedAt;
  }
  if (input.completedAt !== undefined) {
    entry.completedAt = input.completedAt;
  }
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    entry.metadata = input.metadata;
  }
  activities.push(entry);
}

export function activitySummary(activities: RunActivityEntry[]): RunActivitySummary {
  const summary: RunActivitySummary = {
    total: activities.length,
    completed: 0,
    running: 0,
    pending: 0,
    failed: 0,
    blocked: 0,
  };

  for (const activity of activities) {
    if (activity.status === RunActivityStatuses.Completed) {
      summary.completed++;
    } else if (activity.status === RunActivityStatuses.Running) {
      summary.running++;
    } else if (activity.status === RunActivityStatuses.Pending) {
      summary.pending++;
    } else if (activity.status === RunActivityStatuses.Failed) {
      summary.failed++;
    } else if (activity.status === RunActivityStatuses.Blocked) {
      summary.blocked++;
    }
  }

  return summary;
}

export function activityTimestamp(activity: RunActivityEntry): string {
  return activity.completedAt ?? activity.startedAt ?? "";
}
