import { refreshRunStatusFromAttempts } from "@kiwi/core";
import type { SandboxCommandPolicy } from "@kiwi/sandbox";
import { commandProfileForStep, commandProfileToExecutionPolicy, noopCommand } from "../operator-policy";
import { createReviewEngineFromRegistry } from "../provider-review-engine";
import { runRequiredGates } from "../required-gates";
import { StepAttemptOrchestrator } from "../step-attempt-orchestrator";
import { AttemptDiffMaterializer } from "./diff-materializer";
import { ExecutionPolicyResolver } from "./policy";
import type { StepExecutionSession } from "./session";
import { AttemptDiffStatuses, ExecutionToolNames, type RunAttemptResult } from "./types";

export class StepAttemptExecutor {
  constructor(
    private readonly policyResolver: ExecutionPolicyResolver,
    private readonly diffMaterializer: AttemptDiffMaterializer,
  ) {}

  async execute(session: StepExecutionSession): Promise<RunAttemptResult> {
    const commandPolicy = commandProfileToExecutionPolicy(
      commandProfileForStep(session.context.policy, session.step.type),
    ) as SandboxCommandPolicy;
    const reviewEngine = createReviewEngineFromRegistry({
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
      command: session.input.command ?? noopCommand(),
      commandPolicy,
      approved: session.approval.approved,
      ...(session.approval.approvedFiles ? { approvedFiles: session.approval.approvedFiles } : {}),
      postRunnerGateExecutor: (gateInput) =>
        runRequiredGates({
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
      const result = await new StepAttemptOrchestrator<SandboxCommandPolicy>().execute(orchestratorInput);
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
      refreshRunStatusFromAttempts({ cwd: session.cwd, runId: session.runId, now: new Date() });
      throw error;
    }
  }
}
