import type { CoreServices } from "@kiwi/core";
import type { SandboxCommandPolicy } from "@kiwi/sandbox";
import { OperatorPolicyService } from "../operator-policy";
import { createReviewEngineFromRegistry } from "../provider-review-engine";
import { runRequiredGates } from "../required-gates";
import { StepAttemptOrchestrator } from "../step-attempt-orchestrator";
import { AttemptDiffMaterializer } from "./diff-materializer";
import { ExecutionPolicyResolver } from "./policy";
import type { StepExecutionSession } from "./session";
import { AttemptDiffStatuses, ExecutionToolNames, type RunAttemptResult } from "./types";

export class ReviewEngineFactory {
  create(
    params: Parameters<typeof createReviewEngineFromRegistry>[0],
  ): ReturnType<typeof createReviewEngineFromRegistry> {
    return createReviewEngineFromRegistry(params);
  }
}

export class RequiredGateRunner {
  run(params: Parameters<typeof runRequiredGates>[0]): ReturnType<typeof runRequiredGates> {
    return runRequiredGates(params);
  }
}

export class StepAttemptExecutor {
  constructor(
    private readonly policyResolver: ExecutionPolicyResolver,
    private readonly diffMaterializer: AttemptDiffMaterializer,
    private readonly core: CoreServices,
    private readonly operatorPolicy: OperatorPolicyService,
    private readonly orchestrator: StepAttemptOrchestrator<SandboxCommandPolicy>,
    private readonly reviewEngines: ReviewEngineFactory,
    private readonly requiredGates: RequiredGateRunner,
  ) {}

  async execute(session: StepExecutionSession): Promise<RunAttemptResult> {
    const commandPolicy = this.operatorPolicy.commandProfileToExecutionPolicy(
      this.operatorPolicy.commandProfileForStep(session.context.policy, session.step.type),
    ) as SandboxCommandPolicy;
    const reviewEngine = this.reviewEngines.create({
      cwd: session.cwd,
      policy: session.context.policy,
      registryModels: session.context.registry.models,
    });
    const orchestratorInput: Parameters<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>[0] = {
      cwd: session.cwd,
      repoPath: session.context.repoPath,
      step: session.step,
      schedulerDecision: session.enrichedDecision,
      selectedModelId: session.runnerSelection.selectedModelId,
      runner: session.runnerSelection.runnerAdapter,
      worktreePath: session.target.worktreePath,
      executionMode: session.target.mode,
      codexSandbox: this.policyResolver.codexSandbox(session.context.policy),
      diffBaseTree: session.target.diffBaseTree,
      stepPrompt: session.step.title,
      allowedTools: [ExecutionToolNames.Shell],
      command: session.input.command ?? this.operatorPolicy.noopCommand(),
      commandPolicy,
      approved: session.approval.approved,
      ...(session.approval.approvedFiles ? { approvedFiles: session.approval.approvedFiles } : {}),
      postRunnerGateExecutor: (gateInput) =>
        this.requiredGates.run({
          cwd: session.cwd,
          runId: session.runId,
          stepId: session.stepId,
          attemptId: session.enrichedDecision.attemptId,
          worktreePath: session.target.worktreePath,
          policy: session.context.policy,
          requiredGates: session.enrichedDecision.requiredGates,
          approved: session.approval.approved,
          diffHash: gateInput.diffHash,
          now: session.now,
        }),
      policy: session.context.policy,
      now: session.now,
    };

    if (reviewEngine) {
      orchestratorInput.reviewEngine = reviewEngine;
    }

    try {
      const result = await this.orchestrator.execute(orchestratorInput);
      const materializedDiff = this.diffMaterializer.materialize({
        cwd: session.cwd,
        runId: session.runId,
        stepId: session.stepId,
        attemptId: session.enrichedDecision.attemptId,
        repoPath: session.context.repoPath,
        directExecution: session.target.mode === this.policyResolver.directExecutionMode,
        result,
      });

      if (materializedDiff.status === AttemptDiffStatuses.Failed) {
        throw new Error(`Attempt diff could not be applied to current codebase: ${materializedDiff.reason}`);
      }

      return { result, materializedDiff };
    } catch (error) {
      this.core.runStatus.refreshFromAttempts({ cwd: session.cwd, runId: session.runId, now: new Date() });
      throw error;
    }
  }
}
