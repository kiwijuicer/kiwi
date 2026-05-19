import { existsSync } from "fs";
import { ContractValues, StepStatuses, type ModelInvocationRecord, type Step } from "@kiwi/contracts";
import {
  AuditEventTypes,
  latestAttemptByStep,
  listStepAttemptEvidence,
  loadRunManifest,
  loadTaskGraph,
  readAuditEvents,
  readModelInvocations,
  resolveRunArtifactPath,
  type AuditEvent,
  type StepAttemptEvidence,
} from "@kiwi/core";
import {
  activitySummary,
  compactRecord,
  pushActivity,
  RunActivityPhases,
  RunActivityStatuses,
  type RunActivityEntry,
  type RunActivityStatus,
  type RunActivityTimeline,
} from "./activity-timeline-types.js";
import { buildAttemptActivities, statusFromAttempt } from "./activity-attempts.js";

const RUN_LEVEL_EVENT_TYPES = new Set<string>([
  AuditEventTypes.PlannerProviderSelected,
  AuditEventTypes.PlannerRetry,
  AuditEventTypes.PlannerValidationFailed,
  AuditEventTypes.PlannerSucceeded,
  AuditEventTypes.PlannerFailed,
  AuditEventTypes.McpPreviewCreated,
  AuditEventTypes.McpPreviewConsumed,
  AuditEventTypes.McpPreviewPruned,
  AuditEventTypes.ReplanStarted,
  AuditEventTypes.ReplanSucceeded,
  AuditEventTypes.ReplanFailed,
  AuditEventTypes.FixStepInjected,
  AuditEventTypes.RunFinalized,
  AuditEventTypes.PrDraftPublished,
]);

const PLANNER_EVENT_TYPES = new Set<string>([
  AuditEventTypes.PlannerProviderSelected,
  AuditEventTypes.PlannerRetry,
  AuditEventTypes.PlannerValidationFailed,
  AuditEventTypes.PlannerSucceeded,
  AuditEventTypes.PlannerFailed,
]);

function payloadString(event: AuditEvent, key: string): string | null {
  const value = event.payload[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

function payloadStrings(event: AuditEvent, key: string): string[] {
  const value = event.payload[key];

  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function stepEvents(events: AuditEvent[], stepId: string): AuditEvent[] {
  return events.filter((event) => payloadString(event, "stepId") === stepId);
}

function eventOfType(events: AuditEvent[], type: string): AuditEvent | undefined {
  return events.find((event) => event.eventType === type);
}

function eventsOfType(events: AuditEvent[], type: string): AuditEvent[] {
  return events.filter((event) => event.eventType === type);
}

function runArtifactRefs(cwd: string, runId: string, refs: string[]): string[] {
  return refs.filter((ref) => existsSync(resolveRunArtifactPath(runId, ref, cwd)));
}

function statusFromStep(step: Step, attempts: StepAttemptEvidence[], blockedEvents: AuditEvent[]): RunActivityStatus {
  const latest = latestAttemptByStep(attempts).get(step.stepId);

  if (latest) {
    return statusFromAttempt(latest.attempt.status);
  }
  if (blockedEvents.length > 0) {
    return RunActivityStatuses.Blocked;
  }
  if (step.status === ContractValues.Completed) {
    return RunActivityStatuses.Completed;
  }
  if (step.status === ContractValues.Running) {
    return RunActivityStatuses.Running;
  }
  if (step.status === ContractValues.Failed) {
    return RunActivityStatuses.Failed;
  }
  if (step.status === StepStatuses.Skipped) {
    return RunActivityStatuses.Skipped;
  }

  return RunActivityStatuses.Pending;
}

function invocationsByAttempt(invocations: ModelInvocationRecord[]): Map<string, ModelInvocationRecord[]> {
  const byAttempt = new Map<string, ModelInvocationRecord[]>();

  for (const invocation of invocations) {
    if (!invocation.attemptId) {
      continue;
    }
    byAttempt.set(invocation.attemptId, [...(byAttempt.get(invocation.attemptId) ?? []), invocation]);
  }

  return byAttempt;
}

function buildPlanningActivity(params: {
  cwd: string;
  runId: string;
  taskGraphCreatedAt: string;
  events: AuditEvent[];
  activities: RunActivityEntry[];
}): void {
  const plannerEvents = params.events.filter((event) => PLANNER_EVENT_TYPES.has(event.eventType));
  const failed = eventOfType(plannerEvents, AuditEventTypes.PlannerFailed);
  const succeeded = eventOfType(plannerEvents, AuditEventTypes.PlannerSucceeded);
  const selected = eventOfType(plannerEvents, AuditEventTypes.PlannerProviderSelected);

  pushActivity(params.activities, {
    activityId: "run:planning",
    runId: params.runId,
    phase: RunActivityPhases.Planning,
    title: "Plan task graph",
    status: failed ? RunActivityStatuses.Failed : RunActivityStatuses.Completed,
    startedAt: plannerEvents[0]?.timestamp ?? params.taskGraphCreatedAt,
    completedAt: failed?.timestamp ?? succeeded?.timestamp ?? params.taskGraphCreatedAt,
    artifactRefs: runArtifactRefs(params.cwd, params.runId, [
      "plan/task-graph.json",
      "plan/planner-input.json",
      "plan/planner-output.json",
      "plan/cost-report.json",
    ]),
    metadata: compactRecord({
      provider: selected ? payloadString(selected, "providerName") : null,
      model: selected ? payloadString(selected, "modelId") : null,
      retries: eventsOfType(plannerEvents, AuditEventTypes.PlannerRetry).length,
      validationFailures: eventsOfType(plannerEvents, AuditEventTypes.PlannerValidationFailed).length,
    }),
  });
}

function buildRunLevelAuditActivities(runId: string, events: AuditEvent[], activities: RunActivityEntry[]): void {
  let index = 0;

  for (const event of events) {
    if (!RUN_LEVEL_EVENT_TYPES.has(event.eventType)) {
      continue;
    }
    if (
      event.eventType === AuditEventTypes.PlannerProviderSelected ||
      event.eventType === AuditEventTypes.PlannerRetry ||
      event.eventType === AuditEventTypes.PlannerValidationFailed ||
      event.eventType === AuditEventTypes.PlannerSucceeded ||
      event.eventType === AuditEventTypes.PlannerFailed
    ) {
      continue;
    }
    const titleByType: Partial<Record<string, string>> = {
      [AuditEventTypes.McpPreviewCreated]: "Preview execution",
      [AuditEventTypes.McpPreviewConsumed]: "Consume preview",
      [AuditEventTypes.McpPreviewPruned]: "Prune preview",
      [AuditEventTypes.ReplanStarted]: "Replan started",
      [AuditEventTypes.ReplanSucceeded]: "Replan succeeded",
      [AuditEventTypes.ReplanFailed]: "Replan failed",
      [AuditEventTypes.FixStepInjected]: "Inject fix step",
      [AuditEventTypes.RunFinalized]: "Finalize run",
      [AuditEventTypes.PrDraftPublished]: "Publish PR draft",
    };
    const phase =
      event.eventType === AuditEventTypes.McpPreviewCreated ||
      event.eventType === AuditEventTypes.McpPreviewConsumed ||
      event.eventType === AuditEventTypes.McpPreviewPruned
        ? RunActivityPhases.Preview
        : event.eventType === AuditEventTypes.PrDraftPublished
          ? RunActivityPhases.Publish
          : event.eventType === AuditEventTypes.RunFinalized
            ? RunActivityPhases.Finalize
            : RunActivityPhases.Replan;
    const status =
      event.eventType === AuditEventTypes.ReplanFailed
        ? RunActivityStatuses.Failed
        : event.eventType === AuditEventTypes.McpPreviewPruned
          ? RunActivityStatuses.Skipped
          : RunActivityStatuses.Completed;

    pushActivity(activities, {
      activityId: `run:${event.eventType}:${index++}`,
      runId,
      phase,
      title: titleByType[event.eventType] ?? event.eventType,
      status,
      startedAt: event.timestamp,
      completedAt: event.timestamp,
      metadata: compactRecord({
        stepId: payloadString(event, "stepId"),
        attemptId: payloadString(event, "attemptId") ?? payloadString(event, "sourceAttemptId"),
        reason: payloadString(event, "reason"),
        token: payloadString(event, "previewToken"),
      }),
    });
  }
}

function buildFinalizeFallback(runId: string, runStatus: string, activities: RunActivityEntry[]): void {
  if (activities.some((activity) => activity.phase === RunActivityPhases.Finalize)) {
    return;
  }
  const status =
    runStatus === ContractValues.Completed
      ? RunActivityStatuses.Completed
      : runStatus === ContractValues.Failed
        ? RunActivityStatuses.Failed
        : RunActivityStatuses.Pending;

  pushActivity(activities, {
    activityId: "run:finalize",
    runId,
    phase: RunActivityPhases.Finalize,
    title: "Finalize run",
    status,
  });
}

function buildBlockedRoutingActivity(params: {
  runId: string;
  stepId: string;
  parentActivityId: string;
  event: AuditEvent;
  index: number;
  activities: RunActivityEntry[];
}): void {
  pushActivity(params.activities, {
    activityId: `${params.parentActivityId}:blocked-routing:${params.index}`,
    parentActivityId: params.parentActivityId,
    runId: params.runId,
    stepId: params.stepId,
    phase: RunActivityPhases.Routing,
    title: "Select runner/model",
    status: RunActivityStatuses.Blocked,
    startedAt: params.event.timestamp,
    completedAt: params.event.timestamp,
    metadata: compactRecord({
      reason: payloadString(params.event, "reason"),
      model: payloadString(params.event, "modelId"),
      capability: payloadString(params.event, "modelCapability"),
      routingReason: payloadStrings(params.event, "routingReason").join(", "),
    }),
  });
}

function buildStepActivities(params: {
  runId: string;
  taskSteps: Step[];
  attempts: StepAttemptEvidence[];
  events: AuditEvent[];
  invocationsByAttemptId: Map<string, ModelInvocationRecord[]>;
  activities: RunActivityEntry[];
}): void {
  const attemptsByStep = new Map<string, StepAttemptEvidence[]>();

  for (const attempt of params.attempts) {
    attemptsByStep.set(attempt.stepId, [...(attemptsByStep.get(attempt.stepId) ?? []), attempt]);
  }
  for (const step of params.taskSteps) {
    const parentActivityId = `step:${step.stepId}`;
    const stepAttempts = attemptsByStep.get(step.stepId) ?? [];
    const blockedEvents = stepEvents(params.events, step.stepId).filter(
      (event) => event.eventType === AuditEventTypes.SchedulerBlocked,
    );
    const knownAttemptIds = new Set(stepAttempts.map((attempt) => attempt.attemptId));

    pushActivity(params.activities, {
      activityId: parentActivityId,
      runId: params.runId,
      stepId: step.stepId,
      attemptId: latestAttemptByStep(stepAttempts).get(step.stepId)?.attemptId,
      phase: RunActivityPhases.Execution,
      title: `${step.stepId} ${step.title}`,
      status: statusFromStep(step, stepAttempts, blockedEvents),
      startedAt: stepAttempts[0]?.attempt.startedAt,
      completedAt: latestAttemptByStep(stepAttempts).get(step.stepId)?.attempt.completedAt,
      metadata: compactRecord({
        type: step.type,
        role: step.recommendedAgentRole,
        capability: step.recommendedModelCapability,
      }),
    });
    blockedEvents
      .filter((event) => {
        const attemptId = payloadString(event, "attemptId");

        return !attemptId || !knownAttemptIds.has(attemptId);
      })
      .forEach((event, index) =>
        buildBlockedRoutingActivity({
          runId: params.runId,
          stepId: step.stepId,
          parentActivityId,
          event,
          index,
          activities: params.activities,
        }),
      );
    for (const evidence of stepAttempts) {
      buildAttemptActivities({
        runId: params.runId,
        parentActivityId,
        evidence,
        events: params.events,
        invocations: params.invocationsByAttemptId.get(evidence.attemptId) ?? [],
        activities: params.activities,
      });
    }
  }
}

export function buildRunActivityTimeline(params: { cwd: string; runId: string; now?: Date }): RunActivityTimeline {
  const run = loadRunManifest(params.runId, params.cwd);
  const taskGraph = loadTaskGraph(params.runId, params.cwd);
  const events = readAuditEvents(params.cwd, params.runId).sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  const attempts = listStepAttemptEvidence(params.cwd, params.runId);
  const invocations = invocationsByAttempt(readModelInvocations(params.cwd, params.runId));
  const activities: RunActivityEntry[] = [];

  buildPlanningActivity({
    cwd: params.cwd,
    runId: params.runId,
    taskGraphCreatedAt: taskGraph.createdAt,
    events,
    activities,
  });
  buildRunLevelAuditActivities(params.runId, events, activities);
  buildStepActivities({
    runId: params.runId,
    taskSteps: taskGraph.steps,
    attempts,
    events,
    invocationsByAttemptId: invocations,
    activities,
  });
  buildFinalizeFallback(params.runId, run.status, activities);

  return {
    schemaVersion: "1",
    runId: params.runId,
    generatedAt: (params.now ?? new Date()).toISOString(),
    summary: activitySummary(activities),
    activities,
  };
}

export class RunActivityTimelineBuilder {
  build(params: Parameters<typeof buildRunActivityTimeline>[0]): RunActivityTimeline {
    return buildRunActivityTimeline(params);
  }
}
