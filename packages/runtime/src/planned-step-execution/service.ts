import {
  assertStepDependenciesCompleted,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  latestAttemptByStep,
  listStepAttemptEvidence,
  loadInitiative,
  loadLatestApprovalDecisionForStep,
  loadPolicy,
  loadRegistry,
  loadTaskGraph,
  refreshRunStatusFromAttempts,
} from "@kiwi/core";
import { ContractValues, type Initiative, type KiwiPolicy, type ModelEntry, type Step } from "@kiwi/contracts";
import type { SandboxCommandPolicy } from "@kiwi/sandbox";
import { assertDirectExecutionSafe } from "../direct-execution-safety";
import { commandProfileForStep, commandProfileToExecutionPolicy, noopCommand } from "../operator-policy";
import { createReviewEngineFromRegistry } from "../provider-review-engine";
import { runRequiredGates } from "../required-gates";
import type { SchedulerDecision } from "../scheduler-policy";
import { StepAttemptOrchestrator } from "../step-attempt-orchestrator";
import { AttemptDiffMaterializer } from "./diff-materializer";
import { ExecutionPolicyResolver } from "./policy";
import { SchedulerDecisionService } from "./scheduler";
import { StepRunnerSelector, type StepRunnerSelection } from "./runner-selection";
import { ExecutionTargetResolver } from "./target";
import type {
  AttemptDiffMaterialization,
  ExecutePlannedStepInput,
  ExecutePlannedStepResult,
  ExecutionTarget,
  StepAttemptExecutionResult,
} from "./types";

interface ExecutionContext {
  policy: KiwiPolicy;
  registryModels: ModelEntry[];
  initiative: Initiative;
  repoPath: string;
  step: Step;
}

interface ApprovalContext {
  approved: boolean;
  approvedFiles?: string[];
}

interface RunAttemptParams {
  input: ExecutePlannedStepInput;
  context: ExecutionContext;
  runnerSelection: StepRunnerSelection;
  enrichedDecision: SchedulerDecision;
  target: ExecutionTarget;
  approved: boolean;
  approvedFiles?: string[];
  now: Date;
}

interface RunAttemptResult {
  result: StepAttemptExecutionResult;
  materializedDiff: AttemptDiffMaterialization;
}

export class PlannedStepExecutionService {
  private readonly policyResolver = new ExecutionPolicyResolver();
  private readonly runnerSelector = new StepRunnerSelector(this.policyResolver);
  private readonly schedulerDecisionService = new SchedulerDecisionService(this.policyResolver);
  private readonly targetResolver = new ExecutionTargetResolver();
  private readonly diffMaterializer = new AttemptDiffMaterializer();

  async execute(input: ExecutePlannedStepInput): Promise<ExecutePlannedStepResult> {
    const context = this.loadExecutionContext(input);
    const now = input.now ?? new Date();
    const isResearchStep = context.step.type === "context_discovery";
    const runnerResolution = this.runnerSelector.resolveRunnerResolution({
      isResearchStep,
      registryModels: context.registryModels,
      step: context.step,
      policy: context.policy,
    });
    const decision = this.schedulerDecisionService.scheduleCurrentStepAttempt({
      input,
      step: context.step,
      initiative: context.initiative,
      runnerResolution,
      isResearchStep,
      now,
    });
    const approvalContext = this.resolveApprovalContext(input);
    const selectedIsolation = this.policyResolver.executionMode(context.policy);

    if (selectedIsolation === "direct") {
      assertDirectExecutionSafe(context.repoPath);
    }
    const runnerSelection = this.runnerSelector.select({
      cwd: input.cwd,
      runId: input.runId,
      stepId: input.stepId,
      decision,
      registryModels: context.registryModels,
      policy: context.policy,
      runnerResolution,
      isResearchStep,
      now,
    });
    const enrichedDecision = this.schedulerDecisionService.enrich({
      cwd: input.cwd,
      decision,
      policy: context.policy,
      selectedModel: runnerSelection.selectedModel,
      selectedModelId: runnerSelection.selectedModelId,
      executorSelectionReason: runnerSelection.executorSelectionReason,
      isolation: selectedIsolation,
    });
    const target = this.targetResolver.create({
      cwd: input.cwd,
      runId: input.runId,
      attemptId: decision.attemptId,
      repoPath: context.repoPath,
      mode: selectedIsolation,
    });
    let attempt: RunAttemptResult;

    try {
      attempt = await this.runAttempt({
        input,
        context,
        runnerSelection,
        enrichedDecision,
        target,
        approved: approvalContext.approved,
        ...(approvalContext.approvedFiles ? { approvedFiles: approvalContext.approvedFiles } : {}),
        now,
      });
    } finally {
      this.targetResolver.teardown({ cwd: input.cwd, target });
    }
    const run = refreshRunStatusFromAttempts({ cwd: input.cwd, runId: input.runId, now: new Date() });

    return {
      runId: input.runId,
      stepId: input.stepId,
      attemptId: enrichedDecision.attemptId,
      executionMode: target.mode,
      status: attempt.result.status,
      nextAction: attempt.result.nextAction,
      runStatus: run.status,
      materializedDiff: attempt.materializedDiff,
    };
  }

  private loadExecutionContext(input: ExecutePlannedStepInput): ExecutionContext {
    const policy = loadPolicy(kiwiPolicyPath(input.cwd));
    const registry = loadRegistry(kiwiModelRegistryPath(input.cwd));
    const initiative = loadInitiative(input.runId, input.cwd);
    const taskGraph = loadTaskGraph(input.runId, input.cwd);
    const step = taskGraph.steps.find((entry) => entry.stepId === input.stepId);

    if (!step) {
      throw new Error(`Step not found: ${input.stepId}`);
    }
    assertStepDependenciesCompleted({
      cwd: input.cwd,
      runId: input.runId,
      stepId: input.stepId,
      dependsOn: step.dependsOn,
    });

    return {
      policy,
      registryModels: registry.models,
      initiative,
      repoPath: initiative.repoPath || input.cwd,
      step,
    };
  }

  private resolveApprovalContext(input: ExecutePlannedStepInput): ApprovalContext {
    const approval = loadLatestApprovalDecisionForStep({ cwd: input.cwd, runId: input.runId, stepId: input.stepId });
    const latestAttempt = latestAttemptByStep(listStepAttemptEvidence(input.cwd, input.runId)).get(input.stepId);
    const approved = input.approved ?? false;

    if (
      approval?.state === "auto" &&
      latestAttempt?.attempt.status === ContractValues.Blocked &&
      approval.sourceAttemptId === latestAttempt.attemptId
    ) {
      return { approved, approvedFiles: approval.approvalRequiredFiles };
    }

    return { approved };
  }

  private async runAttempt(params: RunAttemptParams): Promise<RunAttemptResult> {
    const commandPolicy = commandProfileToExecutionPolicy(
      commandProfileForStep(params.context.policy, params.context.step.type),
    ) as SandboxCommandPolicy;
    const reviewEngine = createReviewEngineFromRegistry({
      cwd: params.input.cwd,
      policy: params.context.policy,
      registryModels: params.context.registryModels,
    });
    const orchestratorInput: Parameters<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>[0] = {
      cwd: params.input.cwd,
      repoPath: params.context.repoPath,
      step: params.context.step,
      schedulerDecision: params.enrichedDecision,
      selectedModelId: params.runnerSelection.selectedModelId,
      runner: params.runnerSelection.runnerAdapter,
      worktreePath: params.target.worktreePath,
      executionMode: params.target.mode,
      codexSandbox: this.policyResolver.codexSandbox(params.context.policy),
      diffBaseTree: params.target.diffBaseTree,
      stepPrompt: params.context.step.title,
      allowedTools: ["shell"],
      command: params.input.command ?? noopCommand(),
      commandPolicy,
      approved: params.approved,
      ...(params.approvedFiles ? { approvedFiles: params.approvedFiles } : {}),
      postRunnerGateExecutor: (gateInput) =>
        runRequiredGates({
          cwd: params.input.cwd,
          runId: params.input.runId,
          stepId: params.input.stepId,
          attemptId: params.enrichedDecision.attemptId,
          worktreePath: params.target.worktreePath,
          policy: params.context.policy,
          requiredGates: params.enrichedDecision.requiredGates,
          approved: params.approved,
          diffHash: gateInput.diffHash,
          now: params.now,
        }),
      policy: params.context.policy,
      now: params.now,
    };

    if (reviewEngine) {
      orchestratorInput.reviewEngine = reviewEngine;
    }

    try {
      const result = await new StepAttemptOrchestrator<SandboxCommandPolicy>().execute(orchestratorInput);
      const materializedDiff = this.diffMaterializer.materialize({
        cwd: params.input.cwd,
        runId: params.input.runId,
        stepId: params.input.stepId,
        attemptId: params.enrichedDecision.attemptId,
        repoPath: params.context.repoPath,
        directExecution: params.target.mode === "direct",
        result,
      });

      if (materializedDiff.status === ContractValues.Failed) {
        throw new Error(`Attempt diff could not be applied to current codebase: ${materializedDiff.reason}`);
      }

      return { result, materializedDiff };
    } catch (error) {
      refreshRunStatusFromAttempts({ cwd: params.input.cwd, runId: params.input.runId, now: new Date() });
      throw error;
    }
  }
}
