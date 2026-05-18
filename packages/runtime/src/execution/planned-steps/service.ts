import type { CoreServices } from "@kiwi/core";
import { ExecutionIsolations, StepAttemptStatuses } from "@kiwi/contracts";
import { assertDirectExecutionSafe } from "../direct-safety";
import { ExecutionContextLoader } from "./context";
import { StepAttemptExecutor } from "./executor";
import { ExecutionPolicyResolver } from "./policy";
import { SchedulerDecisionService } from "./scheduler";
import { StepRunnerSelector } from "./runner-selection";
import { StepExecutionSession, type ApprovalContext } from "./session";
import { ExecutionTargetResolver } from "./target";
import type { ExecutePlannedStepInput, ExecutePlannedStepResult, RunAttemptResult } from "./types";

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
    const session = this.createSession(input);
    session.setRunnerResolution(this.runnerSelector.resolveRunnerResolution(session));
    this.schedulerDecisionService.schedule(session);
    session.setApproval(this.resolveApprovalContext(session));
    this.assertDirectExecutionAllowed(session);
    this.runnerSelector.select(session);
    this.schedulerDecisionService.enrich(session, this.policyResolver.executionMode(session.context.policy));
    session.setIsolationTarget(
      this.targetResolver.create({
        cwd: session.cwd,
        runId: session.runId,
        attemptId: session.decision.attemptId,
        repoPath: session.context.repoPath,
        mode: session.enrichedDecision.executionIsolation ?? this.policyResolver.directExecutionMode,
      }),
      session.enrichedDecision.executionIsolation ?? this.policyResolver.directExecutionMode,
    );

    const attempt = await this.executeWithTargetCleanup(session);
    const run = this.core.runStatus.refreshFromAttempts({ cwd: session.cwd, runId: session.runId, now: new Date() });

    return {
      runId: session.runId,
      stepId: session.stepId,
      attemptId: session.enrichedDecision.attemptId,
      executionMode: session.target.mode,
      status: attempt.result.status,
      nextAction: attempt.result.nextAction,
      runStatus: run.status,
      materializedDiff: attempt.materializedDiff,
    };
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

  private async executeWithTargetCleanup(session: StepExecutionSession): Promise<RunAttemptResult> {
    try {
      return await this.attemptExecutor.execute(session);
    } finally {
      this.targetResolver.teardown({ cwd: session.cwd, target: session.target });
    }
  }
}
