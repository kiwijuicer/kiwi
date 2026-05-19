import { appendAuditEvent, AuditEventTypes, type CoreServices } from "@kiwi/core";
import { ExecutionIsolations, StepAttemptStatuses, type RunnerName } from "@kiwi/contracts";
import { ProviderFailureCodes } from "@kiwi/adapters";
import { assertDirectExecutionSafe } from "../direct-safety.js";
import { ExecutionContextLoader } from "./context.js";
import { StepAttemptExecutor } from "./executor.js";
import { ExecutionPolicyResolver } from "./policy.js";
import { SchedulerDecisionService } from "./scheduler.js";
import { StepRunnerSelector } from "./runner-selection.js";
import { StepExecutionSession, type ApprovalContext } from "./session.js";
import { ExecutionTargetResolver } from "./target.js";
import type {
  ExecutePlannedStepInput,
  ExecutePlannedStepResult,
  ProviderFallbackResult,
  RunAttemptResult,
} from "./types.js";

export class PlannedStepExecutionService {
  constructor(
    private readonly contextLoader: ExecutionContextLoader,
    private readonly policyResolver: ExecutionPolicyResolver,
    private readonly core: CoreServices,
    private readonly runnerSelector: StepRunnerSelector,
    private readonly schedulerDecisionService: SchedulerDecisionService,
    private readonly targetResolver: ExecutionTargetResolver,
    private readonly attemptExecutor: StepAttemptExecutor,
  ) {}

  async execute(input: ExecutePlannedStepInput): Promise<ExecutePlannedStepResult> {
    const session = this.prepareSession(input);
    const firstAttempt = await this.executeWithTargetCleanup(session);
    const fallback = await this.executeProviderFallback({ input, session, firstAttempt });
    const attempt = fallback?.attempt ?? firstAttempt;
    const run = this.core.runStatus.refreshFromAttempts({ cwd: session.cwd, runId: session.runId, now: new Date() });
    const result: ExecutePlannedStepResult = {
      runId: session.runId,
      stepId: session.stepId,
      attemptId: attempt.result.attemptId,
      executionMode: fallback?.session.target.mode ?? session.target.mode,
      status: attempt.result.status,
      nextAction: attempt.result.nextAction,
      runStatus: run.status,
      materializedDiff: attempt.materializedDiff,
    };

    if (fallback) {
      result.fallback = fallback.result;
    }

    return result;
  }

  private createSession(input: ExecutePlannedStepInput): StepExecutionSession {
    const context = this.contextLoader.load(input);
    const step = context.step(input.stepId);
    this.contextLoader.assertStepReady(context, step);

    return new StepExecutionSession(input, context, step);
  }

  private resolveApprovalContext(session: StepExecutionSession): ApprovalContext {
    const approval = this.core.approvals.loadLatestForStep({
      cwd: session.cwd,
      runId: session.runId,
      stepId: session.stepId,
    });
    const latestAttempt = this.core.evidence
      .latestAttemptByStep(this.core.evidence.listStepAttempts(session.cwd, session.runId))
      .get(session.stepId);
    const approved = session.input.approved ?? false;

    if (
      approval?.state === "auto" &&
      latestAttempt?.attempt.status === StepAttemptStatuses.Blocked &&
      approval.sourceAttemptId === latestAttempt.attemptId
    ) {
      return { approved, approvedFiles: approval.approvalRequiredFiles };
    }

    return { approved };
  }

  private assertDirectExecutionAllowed(session: StepExecutionSession): void {
    if (this.policyResolver.executionMode(session.context.policy) === ExecutionIsolations.Direct) {
      assertDirectExecutionSafe(session.context.repoPath);
    }
  }

  private prepareSession(
    input: ExecutePlannedStepInput,
    runnerAvailabilityOverride?: RunnerName[] | undefined,
  ): StepExecutionSession {
    const session = this.createSession(input);
    const runnerResolution = this.runnerSelector.resolveRunnerResolution(session);

    session.setRunnerResolution(
      runnerResolution && runnerAvailabilityOverride
        ? { ...runnerResolution, runnerAvailability: runnerAvailabilityOverride }
        : runnerResolution,
    );
    this.schedulerDecisionService.schedule(session);
    session.setApproval(this.resolveApprovalContext(session));
    this.assertDirectExecutionAllowed(session);
    this.runnerSelector.select(session);
    this.schedulerDecisionService.enrich(session, this.policyResolver.executionMode(session.context.policy));
    session.setIsolationTarget(
      this.targetResolver.create({
        cwd: session.cwd,
        runId: session.runId,
        stepId: session.stepId,
        attemptId: session.decision.attemptId,
        repoPath: session.context.repoPath,
        mode: session.enrichedDecision.executionIsolation ?? this.policyResolver.directExecutionMode,
      }),
      session.enrichedDecision.executionIsolation ?? this.policyResolver.directExecutionMode,
    );

    return session;
  }

  private async executeProviderFallback(params: {
    input: ExecutePlannedStepInput;
    session: StepExecutionSession;
    firstAttempt: RunAttemptResult;
  }): Promise<{ attempt: RunAttemptResult; result: ProviderFallbackResult; session: StepExecutionSession } | null> {
    const error = params.firstAttempt.result.error;
    const failedRunner = params.session.enrichedDecision.runner;

    if (error?.code !== ProviderFailureCodes.RateLimited || !failedRunner || !params.session.runnerResolution) {
      return null;
    }
    const runnerAvailability = params.session.runnerResolution.runnerAvailability.filter(
      (runner) => runner !== failedRunner,
    );

    if (runnerAvailability.length === 0) {
      return null;
    }
    const fallbackInput = {
      ...params.input,
      attemptId: `${params.firstAttempt.result.attemptId}_fallback_${Date.now()}`,
      now: new Date(),
    };
    const fallbackSession = this.prepareSession(fallbackInput, runnerAvailability);

    appendAuditEvent(params.session.cwd, {
      eventType: AuditEventTypes.ProviderFallbackSelected,
      runId: params.session.runId,
      timestamp: new Date().toISOString(),
      payload: {
        stepId: params.session.stepId,
        failedAttemptId: params.firstAttempt.result.attemptId,
        failedRunner,
        reason: error.message,
        replacementAttemptId: fallbackSession.enrichedDecision.attemptId,
        replacementRunner: fallbackSession.enrichedDecision.runner,
        replacementModelId: fallbackSession.enrichedDecision.selectedModelId ?? null,
      },
    });
    const attempt = await this.executeWithTargetCleanup(fallbackSession);

    return {
      attempt,
      result: {
        reason: error.message,
        failedAttemptId: params.firstAttempt.result.attemptId,
        failedRunner,
        replacementAttemptId: fallbackSession.enrichedDecision.attemptId,
        replacementRunner: fallbackSession.enrichedDecision.runner ?? "unknown",
        replacementModelId: fallbackSession.enrichedDecision.selectedModelId ?? null,
      },
      session: fallbackSession,
    };
  }

  private async executeWithTargetCleanup(session: StepExecutionSession): Promise<RunAttemptResult> {
    try {
      return await this.attemptExecutor.execute(session);
    } finally {
      this.targetResolver.teardown({ cwd: session.cwd, target: session.target });
    }
  }
}
