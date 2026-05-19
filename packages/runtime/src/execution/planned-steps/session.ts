import { StepTypes, type Step } from "@kiwi/contracts";
import type { RunnerResolution } from "../../registries/runner-registry.js";
import type { SchedulerDecision } from "../../policies/scheduler-policy.js";
import type { ExecutionRunContext } from "./context.js";
import type { ExecutePlannedStepInput, ExecutionMode, ExecutionTarget, StepRunnerSelection } from "./types.js";

export interface ApprovalContext {
  approved: boolean;
  approvedFiles?: string[];
}

export class StepExecutionSession {
  private selectedRunnerResolution: RunnerResolution | null = null;
  private approvalContext: ApprovalContext;
  private scheduledDecision: SchedulerDecision | null = null;
  private enrichedSchedulerDecision: SchedulerDecision | null = null;
  private selectedRunner: StepRunnerSelection | null = null;
  private selectedTarget: ExecutionTarget | null = null;

  constructor(
    readonly input: ExecutePlannedStepInput,
    readonly context: ExecutionRunContext,
    readonly step: Step,
  ) {
    this.approvalContext = { approved: input.approved ?? false };
  }

  get cwd(): string {
    return this.context.cwd;
  }

  get runId(): string {
    return this.context.runId;
  }

  get stepId(): string {
    return this.step.stepId;
  }

  get now(): Date {
    return this.context.now;
  }

  get isResearchStep(): boolean {
    return this.step.type === StepTypes.ContextDiscovery;
  }

  get runnerResolution(): RunnerResolution | null {
    return this.selectedRunnerResolution;
  }

  setRunnerResolution(runnerResolution: RunnerResolution | null): void {
    this.selectedRunnerResolution = runnerResolution;
  }

  get approval(): ApprovalContext {
    return this.approvalContext;
  }

  setApproval(approval: ApprovalContext): void {
    this.approvalContext = approval;
  }

  get decision(): SchedulerDecision {
    if (!this.scheduledDecision) {
      throw new Error("Step execution session has no scheduler decision");
    }

    return this.scheduledDecision;
  }

  setDecision(decision: SchedulerDecision): void {
    this.scheduledDecision = decision;
  }

  get enrichedDecision(): SchedulerDecision {
    if (!this.enrichedSchedulerDecision) {
      throw new Error("Step execution session has no enriched scheduler decision");
    }

    return this.enrichedSchedulerDecision;
  }

  setEnrichedDecision(decision: SchedulerDecision): void {
    this.enrichedSchedulerDecision = decision;
  }

  get runnerSelection(): StepRunnerSelection {
    if (!this.selectedRunner) {
      throw new Error("Step execution session has no runner selection");
    }

    return this.selectedRunner;
  }

  setRunnerSelection(selection: StepRunnerSelection): void {
    this.selectedRunner = selection;
  }

  get target(): ExecutionTarget {
    if (!this.selectedTarget) {
      throw new Error("Step execution session has no execution target");
    }

    return this.selectedTarget;
  }

  setTarget(target: ExecutionTarget): void {
    this.selectedTarget = target;
  }

  setIsolationTarget(target: ExecutionTarget, isolation: ExecutionMode): void {
    if (target.mode !== isolation) {
      throw new Error(`Execution target mode ${target.mode} does not match selected isolation ${isolation}`);
    }
    this.setTarget(target);
  }
}
