import type { CoreServices } from "@kiwi/core";
import type { SandboxCommandPolicy } from "@kiwi/sandbox";
import { OperatorPolicyService } from "../../policies/operator-policy.js";
import { createReviewEngineFromRegistry } from "../../review/provider-review-engine.js";
import { runRequiredGates } from "../../gates/required-gates.js";
import { StepAttemptOrchestrator } from "../step-attempt-orchestrator.js";
import { AttemptDiffMaterializer } from "./diff-materializer.js";
import { ExecutionPolicyResolver } from "./policy.js";
import type { StepExecutionSession } from "./session.js";
import { AttemptDiffStatuses, ExecutionToolNames, type RunAttemptResult } from "./types.js";

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
      env: this.policyResolver.environment(),
    });
    const orchestratorInput: Parameters<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>[0] = {
      cwd: session.cwd,
      repoPath: session.context.repoPath,
      step: session.step,
      schedulerDecision: session.enrichedDecision,
      selectedModelId: session.runnerSelection.selectedModelId,
      selectedModel: session.runnerSelection.selectedModel,
      runner: session.runnerSelection.runnerAdapter,
      worktreePath: session.target.worktreePath,
      executionMode: session.target.mode,
      codexSandbox: this.policyResolver.codexSandbox(session.context.policy),
      diffBaseTree: session.target.diffBaseTree,
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
