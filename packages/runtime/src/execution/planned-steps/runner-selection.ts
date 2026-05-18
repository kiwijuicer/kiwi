import {
  AccessModes,
  AgentRoles,
  RunnerNames,
  SchedulerDecisionStatuses,
  type KiwiPolicy,
  type ModelEntry,
  type Step,
} from "@kiwi/contracts";
import { ResearcherProviderRegistry } from "../../registries/researcher-provider-registry";
import { LocalResearchStepRunner, ResearcherStepRunner } from "../researcher-step-runner";
import { RunnerResolver } from "../../registries/runner-resolution";
import type { RunnerResolution } from "../../registries/runner-registry";
import type { SchedulerDecision } from "../../policies/scheduler-policy";
import { ExecutionAuditReporter } from "./audit";
import { ExecutionPolicyResolver } from "./policy";
import type { StepExecutionSession } from "./session";
import { ExecutorSelectionReasons, type StepPreviewSelection, type StepRunnerSelection } from "./types";

export class StepRunnerSelector {
  constructor(
    private readonly policyResolver: ExecutionPolicyResolver,
    private readonly auditReporter: ExecutionAuditReporter,
    private readonly runnerResolver: RunnerResolver,
    private readonly researcherProviderRegistry: ResearcherProviderRegistry,
  ) {}

  resolveRunnerResolution(session: StepExecutionSession): RunnerResolution | null {
    if (session.isResearchStep) {
      return null;
    }

    return this.resolveNonResearchRunner({
      registryModels: session.context.registry.models,
      step: session.step,
      policy: session.context.policy,
    });
  }

  resolveNonResearchRunner(params: { registryModels: ModelEntry[]; step: Step; policy: KiwiPolicy }): RunnerResolution {
    return this.runnerResolver.resolve({
      registryModels: params.registryModels,
      step: params.step,
      preferenceByRole: params.policy.routing.providerPreference,
      env: this.policyResolver.environment(),
    });
  }

  select(session: StepExecutionSession): StepRunnerSelection {
    const selection = this.runnerSelection({
      cwd: session.cwd,
      runId: session.runId,
      stepId: session.stepId,
      decision: session.decision,
      registryModels: session.context.registry.models,
      policy: session.context.policy,
      runnerResolution: session.runnerResolution,
      isResearchStep: session.isResearchStep,
      now: session.now,
    });
    session.setRunnerSelection(selection);

    return selection;
  }

  previewSelection(params: {
    decision: SchedulerDecision;
    isResearchStep: boolean;
    registryModels: ModelEntry[];
    policy: KiwiPolicy;
    runnerResolution: RunnerResolution | null;
  }): StepPreviewSelection {
    if (params.decision.status !== SchedulerDecisionStatuses.Scheduled) {
      return { selectedModel: null, selectedModelId: null, reason: null };
    }
    if (params.isResearchStep && !this.policyResolver.useProviderResearch()) {
      return {
        selectedModel: null,
        selectedModelId: "local-researcher",
        reason: ExecutorSelectionReasons.LocalResearcher,
      };
    }
    if (params.isResearchStep) {
      const selected = this.researcherProviderRegistry.select({
        registryModels: params.registryModels,
        preferenceByRole: params.policy.routing.providerPreference,
        env: this.policyResolver.environment(),
      });

      return {
        selectedModel: selected?.model ?? null,
        selectedModelId: selected?.model.id ?? null,
        reason: selected ? ExecutorSelectionReasons.ResearcherProvider : ExecutorSelectionReasons.NoModelAvailable,
      };
    }
    const selection = params.runnerResolution?.selectExecutorModel(params.decision.modelCapability);

    return {
      selectedModel: selection?.model ?? null,
      selectedModelId: selection?.model?.id ?? null,
      reason: selection?.reason ?? null,
    };
  }

  private runnerSelection(params: {
    cwd: string;
    runId: string;
    stepId: string;
    decision: SchedulerDecision;
    registryModels: ModelEntry[];
    policy: KiwiPolicy;
    runnerResolution: RunnerResolution | null;
    isResearchStep: boolean;
    now: Date;
  }): StepRunnerSelection {
    if (params.isResearchStep && !this.policyResolver.useProviderResearch()) {
      return {
        runnerAdapter: new LocalResearchStepRunner(params.policy),
        selectedModel: null,
        selectedModelId: "local-researcher",
        executorSelectionReason: ExecutorSelectionReasons.LocalResearcher,
      };
    }
    const researcherSelection = this.researcherSelection(params);
    const executorSelection = params.runnerResolution?.selectExecutorModel(params.decision.modelCapability);

    if (executorSelection) {
      this.auditReporter.executorModelSelected({
        cwd: params.cwd,
        runId: params.runId,
        stepId: params.stepId,
        attemptId: params.decision.attemptId,
        runner: params.decision.runner ?? RunnerNames.Api,
        selection: executorSelection,
        now: params.now,
      });
      this.auditReporter.providerPreferenceApplied({
        cwd: params.cwd,
        runId: params.runId,
        stepId: params.stepId,
        attemptId: params.decision.attemptId,
        role: AgentRoles.Executor,
        selectedAccessMode: executorSelection.model?.accessMode ?? null,
        selectedModelId: executorSelection.model?.id ?? null,
        preference: params.policy.routing.providerPreference.executor ?? [],
        now: params.now,
      });
    }
    if (params.isResearchStep && researcherSelection) {
      return {
        runnerAdapter: new ResearcherStepRunner(
          researcherSelection.provider,
          researcherSelection.model,
          params.policy,
          researcherSelection.model.accessMode,
        ),
        selectedModel: researcherSelection.model,
        selectedModelId: researcherSelection.model.id,
        executorSelectionReason: ExecutorSelectionReasons.ResearcherProvider,
      };
    }

    return this.executorRunnerSelection(params, executorSelection?.model, executorSelection?.reason ?? null);
  }

  private researcherSelection(params: {
    isResearchStep: boolean;
    registryModels: ModelEntry[];
    policy: KiwiPolicy;
  }): ReturnType<ResearcherProviderRegistry["select"]> {
    if (!params.isResearchStep) {
      return null;
    }
    const selection = this.researcherProviderRegistry.select({
      registryModels: params.registryModels,
      preferenceByRole: params.policy.routing.providerPreference,
      env: this.policyResolver.environment(),
    });

    if (!selection) {
      throw new Error("No enabled researcher model with an available access mode found in the effective model registry");
    }

    return selection;
  }

  private executorRunnerSelection(
    params: {
      stepId: string;
      decision: SchedulerDecision;
      runnerResolution: RunnerResolution | null;
    },
    selectedModel: ModelEntry | null | undefined,
    reason: string | null,
  ): StepRunnerSelection {
    if (!params.runnerResolution || !params.decision.runner) {
      throw new Error("Runner resolution is required for non-research steps");
    }
    if (params.decision.runner === RunnerNames.Codex) {
      this.assertCodexSelection(params.stepId, selectedModel ?? null);
    }

    return {
      runnerAdapter: params.runnerResolution.buildAdapter(params.decision.runner, selectedModel),
      selectedModel: selectedModel ?? null,
      selectedModelId: selectedModel?.id ?? null,
      executorSelectionReason: reason,
    };
  }

  private assertCodexSelection(stepId: string, selectedModel: ModelEntry | null): void {
    if (!selectedModel || selectedModel.accessMode !== AccessModes.CodexCli) {
      throw new Error(
        `Codex runner selected for ${stepId}, but no matching codex-cli model is available in the effective model registry`,
      );
    }
    if (!selectedModel.providerModel) {
      throw new Error(`Codex model '${selectedModel.id}' must define providerModel for enforced model switching`);
    }
  }
}
