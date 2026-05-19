import { ArtifactTypes, ContractValues, type ModelInvocationRecord, type StepAttemptStatus } from "@kiwi/contracts";
import { AuditEventTypes, type AuditEvent, type StepAttemptEvidence } from "@kiwi/core";
import {
  compactRecord,
  pushActivity,
  RunActivityPhases,
  RunActivityStatuses,
  type RunActivityEntry,
  type RunActivityStatus,
} from "./activity-timeline-types.js";

export function statusFromAttempt(status: StepAttemptStatus): RunActivityStatus {
  if (status === ContractValues.Completed) {
    return RunActivityStatuses.Completed;
  }
  if (status === ContractValues.Failed) {
    return RunActivityStatuses.Failed;
  }
  if (status === ContractValues.Blocked) {
    return RunActivityStatuses.Blocked;
  }
  if (status === ContractValues.Cancelled) {
    return RunActivityStatuses.Skipped;
  }

  return RunActivityStatuses.Running;
}

class AttemptActivityBuilder {
  private readonly attemptAuditEvents: AuditEvent[];
  private readonly executorInvocation: ModelInvocationRecord | undefined;
  private readonly reviewerInvocation: ModelInvocationRecord | undefined;

  constructor(private readonly params: AttemptActivityParams) {
    this.attemptAuditEvents = this.attemptEvents(params.events, params.evidence.stepId, params.evidence.attemptId);
    this.executorInvocation = params.invocations.find((invocation) => invocation.phase === ContractValues.Executor);
    this.reviewerInvocation = params.invocations.find((invocation) => invocation.phase === ContractValues.Reviewer);
  }

  build(): void {
    this.pushRouting();
    this.pushContext();
    this.pushExecution();
    this.pushDiff();
    this.pushGateReview();
    this.pushNextAndApprovals();
  }

  private payloadString(event: AuditEvent, key: string): string | null {
    const value = event.payload[key];

    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private attemptEvents(events: AuditEvent[], stepId: string, attemptId: string): AuditEvent[] {
    return events.filter(
      (event) => this.payloadString(event, "stepId") === stepId && this.payloadString(event, "attemptId") === attemptId,
    );
  }

  private eventOfType(events: AuditEvent[], type: string): AuditEvent | undefined {
    return events.find((event) => event.eventType === type);
  }

  private eventsOfType(events: AuditEvent[], type: string): AuditEvent[] {
    return events.filter((event) => event.eventType === type);
  }

  private artifactRefsForAttempt(): string[] {
    const { evidence } = this.params;

    return [
      `steps/${evidence.stepId}/${evidence.attemptId}/attempt.json`,
      evidence.schedulerDecisionRef,
      evidence.attempt.contextPackageRef,
      evidence.gateResultsRef,
      evidence.reviewReportRef,
      evidence.summaryRef,
      ...evidence.attempt.artifacts.map((artifact) => artifact.ref),
    ].filter((ref): ref is string => typeof ref === "string" && ref.length > 0);
  }

  private gateStatus(): RunActivityStatus {
    const { evidence } = this.params;

    if (evidence.gateResults.some((gate) => gate.status === ContractValues.Blocked)) {
      return RunActivityStatuses.Blocked;
    }
    if (evidence.gateResults.some((gate) => gate.status === ContractValues.Fail)) {
      return RunActivityStatuses.Failed;
    }
    if (evidence.gateResults.length > 0) {
      return RunActivityStatuses.Completed;
    }
    if (evidence.attempt.status === ContractValues.Running || evidence.attempt.status === ContractValues.Pending) {
      return RunActivityStatuses.Pending;
    }

    return RunActivityStatuses.Skipped;
  }

  private reviewStatus(): RunActivityStatus {
    const { evidence } = this.params;

    if (evidence.reviewVerdict) {
      return evidence.reviewVerdict.safeToContinue ? RunActivityStatuses.Completed : RunActivityStatuses.Failed;
    }
    if (evidence.attempt.status === ContractValues.Completed) {
      return RunActivityStatuses.Pending;
    }
    if (evidence.attempt.status === ContractValues.Running || evidence.attempt.status === ContractValues.Pending) {
      return RunActivityStatuses.Pending;
    }

    return RunActivityStatuses.Skipped;
  }

  private diffStatus(): RunActivityStatus {
    const { evidence } = this.params;

    if (this.eventOfType(this.attemptAuditEvents, AuditEventTypes.AttemptDiffApplyFailed)) {
      return RunActivityStatuses.Failed;
    }
    if (
      this.eventOfType(this.attemptAuditEvents, AuditEventTypes.AttemptDiffApplied) ||
      evidence.attempt.artifacts.some(
        (artifact) => artifact.type === ArtifactTypes.Diff || artifact.type === ArtifactTypes.Patch,
      )
    ) {
      return RunActivityStatuses.Completed;
    }
    if (evidence.attempt.status === ContractValues.Running || evidence.attempt.status === ContractValues.Pending) {
      return RunActivityStatuses.Pending;
    }

    return RunActivityStatuses.Skipped;
  }

  private routingStatus(): RunActivityStatus {
    const { evidence } = this.params;

    return evidence.schedulerDecision?.status === ContractValues.Blocked
      ? RunActivityStatuses.Blocked
      : RunActivityStatuses.Completed;
  }

  private modelMetadata(invocation: ModelInvocationRecord | undefined): Record<string, unknown> {
    if (!invocation) {
      return {};
    }

    return (
      compactRecord({
        model: invocation.modelId,
        provider: invocation.providerName,
        runner: invocation.runner,
        accessMode: invocation.accessMode,
        capability: invocation.selectedCapability,
      }) ?? {}
    );
  }

  private pushRouting(): void {
    const { params } = this;

    pushActivity(params.activities, {
      activityId: `${params.parentActivityId}:${params.evidence.attemptId}:routing`,
      parentActivityId: params.parentActivityId,
      runId: params.runId,
      stepId: params.evidence.stepId,
      attemptId: params.evidence.attemptId,
      phase: RunActivityPhases.Routing,
      title: "Select runner/model",
      status: this.routingStatus(),
      startedAt: params.evidence.attempt.startedAt,
      completedAt: params.evidence.attempt.startedAt,
      artifactRefs: params.evidence.schedulerDecisionRef ? [params.evidence.schedulerDecisionRef] : [],
      metadata: compactRecord({
        runner: params.evidence.schedulerDecision?.runner ?? params.evidence.attempt.runner,
        capability: params.evidence.schedulerDecision?.modelCapability ?? params.evidence.attempt.modelCapability,
        reason: params.evidence.schedulerDecision?.blockedReason,
        routingReason: params.evidence.schedulerDecision?.routingReason.join(", "),
        ...this.modelMetadata(this.executorInvocation),
      }),
    });
  }

  private pushContext(): void {
    const { params } = this;

    pushActivity(params.activities, {
      activityId: `${params.parentActivityId}:${params.evidence.attemptId}:context`,
      parentActivityId: params.parentActivityId,
      runId: params.runId,
      stepId: params.evidence.stepId,
      attemptId: params.evidence.attemptId,
      phase: RunActivityPhases.Context,
      title: "Build context package",
      status: params.evidence.attempt.contextPackageRef ? RunActivityStatuses.Completed : RunActivityStatuses.Pending,
      startedAt: params.evidence.attempt.startedAt,
      completedAt: params.evidence.attempt.startedAt,
      artifactRefs: params.evidence.attempt.contextPackageRef ? [params.evidence.attempt.contextPackageRef] : [],
    });
  }

  private pushExecution(): void {
    const { params } = this;

    pushActivity(params.activities, {
      activityId: `${params.parentActivityId}:${params.evidence.attemptId}:execution`,
      parentActivityId: params.parentActivityId,
      runId: params.runId,
      stepId: params.evidence.stepId,
      attemptId: params.evidence.attemptId,
      phase: RunActivityPhases.Execution,
      title: "Run executor",
      status: statusFromAttempt(params.evidence.attempt.status),
      startedAt: params.evidence.attempt.startedAt,
      completedAt: params.evidence.attempt.completedAt,
      artifactRefs: this.artifactRefsForAttempt(),
      metadata: compactRecord({
        runner: params.evidence.attempt.runner,
        status: params.evidence.summary?.runnerStatus,
        ...this.modelMetadata(this.executorInvocation),
      }),
    });
  }

  private pushDiff(): void {
    const { params } = this;

    pushActivity(params.activities, {
      activityId: `${params.parentActivityId}:${params.evidence.attemptId}:diff`,
      parentActivityId: params.parentActivityId,
      runId: params.runId,
      stepId: params.evidence.stepId,
      attemptId: params.evidence.attemptId,
      phase: RunActivityPhases.Diff,
      title: "Capture diff",
      status: this.diffStatus(),
      completedAt: params.evidence.attempt.completedAt,
      artifactRefs: params.evidence.attempt.artifacts
        .filter((artifact) => artifact.type === ArtifactTypes.Diff || artifact.type === ArtifactTypes.Patch)
        .map((artifact) => artifact.ref),
    });
  }

  private pushGateReview(): void {
    const { params } = this;
    const gateStatus = this.gateStatus();

    pushActivity(params.activities, {
      activityId: `${params.parentActivityId}:${params.evidence.attemptId}:gates`,
      parentActivityId: params.parentActivityId,
      runId: params.runId,
      stepId: params.evidence.stepId,
      attemptId: params.evidence.attemptId,
      phase: RunActivityPhases.Gate,
      title: "Run gates",
      status: gateStatus,
      completedAt: params.evidence.attempt.completedAt,
      artifactRefs: params.evidence.gateResultsRef ? [params.evidence.gateResultsRef] : [],
      metadata: compactRecord({
        gates: params.evidence.gateResults.length,
        gateStatus,
      }),
    });
    pushActivity(params.activities, {
      activityId: `${params.parentActivityId}:${params.evidence.attemptId}:review`,
      parentActivityId: params.parentActivityId,
      runId: params.runId,
      stepId: params.evidence.stepId,
      attemptId: params.evidence.attemptId,
      phase: RunActivityPhases.Review,
      title: "Review attempt",
      status: this.reviewStatus(),
      completedAt: params.evidence.attempt.completedAt,
      artifactRefs: params.evidence.reviewReportRef ? [params.evidence.reviewReportRef] : [],
      metadata: compactRecord({
        verdict: params.evidence.reviewVerdict?.verdict,
        safeToContinue: params.evidence.reviewVerdict?.safeToContinue,
        ...this.modelMetadata(this.reviewerInvocation),
      }),
    });
  }

  private pushNextAndApprovals(): void {
    const { params } = this;

    if (params.evidence.summary) {
      pushActivity(params.activities, {
        activityId: `${params.parentActivityId}:${params.evidence.attemptId}:next-action`,
        parentActivityId: params.parentActivityId,
        runId: params.runId,
        stepId: params.evidence.stepId,
        attemptId: params.evidence.attemptId,
        phase: RunActivityPhases.Review,
        title: `Next action: ${params.evidence.summary.nextAction.type}`,
        status: statusFromAttempt(params.evidence.summary.status),
        completedAt: params.evidence.summary.completedAt,
        artifactRefs: params.evidence.summaryRef ? [params.evidence.summaryRef] : [],
        metadata: compactRecord({ reason: params.evidence.summary.nextAction.reason }),
      });
    }
    for (const event of this.eventsOfType(this.attemptAuditEvents, AuditEventTypes.ApprovalDecisionRecorded)) {
      pushActivity(params.activities, {
        activityId: `${params.parentActivityId}:${params.evidence.attemptId}:approval:${event.timestamp}`,
        parentActivityId: params.parentActivityId,
        runId: params.runId,
        stepId: params.evidence.stepId,
        attemptId: params.evidence.attemptId,
        phase: RunActivityPhases.Approval,
        title: "Record approval",
        status:
          this.payloadString(event, "state") === ContractValues.Blocked
            ? RunActivityStatuses.Blocked
            : RunActivityStatuses.Completed,
        startedAt: event.timestamp,
        completedAt: event.timestamp,
        metadata: compactRecord({
          state: this.payloadString(event, "state"),
          approvedBy: this.payloadString(event, "approvedBy"),
        }),
      });
    }
  }
}

interface AttemptActivityParams {
  runId: string;
  parentActivityId: string;
  evidence: StepAttemptEvidence;
  events: AuditEvent[];
  invocations: ModelInvocationRecord[];
  activities: RunActivityEntry[];
}

export function buildAttemptActivities(params: AttemptActivityParams): void {
  new AttemptActivityBuilder(params).build();
}
