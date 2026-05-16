import { AccessModes, ContractValues, KiwiPolicy, ModelEntry, RunnerNames, Step } from "@kiwi/contracts";
import { LocalResearchStepRunner, ResearcherStepRunner } from "../researcher-step-runner";
import { ResearcherProviderRegistry } from "../researcher-provider-registry";
import { resolveRunner } from "../runner-resolution";
import type { RunnerResolution } from "../runner-registry";
import type { SchedulerDecision } from "../scheduler-policy";
import type { StepAttemptRunner } from "../step-runner-types";
import type { SandboxCommandPolicy } from "@kiwi/sandbox";
import { ExecutionAuditReporter } from "./audit";
import { ExecutionPolicyResolver } from "./policy";

export interface StepRunnerSelection {
  runnerAdapter: StepAttemptRunner<SandboxCommandPolicy>;
  selectedModel: ModelEntry | null;
  selectedModelId: string | null;
  executorSelectionReason: string | null;
}

interface StepPreviewSelection {
  selectedModel: ModelEntry | null;
  selectedModelId: string | null;
  reason: string | null;
}

export class StepRunnerSelector {
  constructor(
    private readonly policyResolver = new ExecutionPolicyResolver(),
    private readonly auditReporter = new ExecutionAuditReporter(),
  ) {}

  resolveRunnerResolution(params: {
    isResearchStep: boolean;
    registryModels: ModelEntry[];
    step: Step;
    policy: KiwiPolicy;
  }): RunnerResolution | null {
    if (params.isResearchStep) {
      return null;
    }

    return resolveRunner({
      registryModels: params.registryModels,
      step: params.step,
      preferenceByRole: params.policy.routing.providerPreference,
    });
  }

  select(params: {
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
        executorSelectionReason: "local_researcher",
      };
    }

    const researcherSelection = params.isResearchStep
      ? new ResearcherProviderRegistry().select({
          registryModels: params.registryModels,
          preferenceByRole: params.policy.routing.providerPreference,
        })
      : null;

    if (params.isResearchStep && !researcherSelection) {
      throw new Error("No enabled researcher model with an available access mode found in .kiwi/model-registry.yaml");
    }

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
        role: ContractValues.Executor,
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
        executorSelectionReason: "researcher_provider",
      };
    }

    if (!params.runnerResolution || !params.decision.runner) {
      throw new Error("Runner resolution is required for non-research steps");
    }
    if (params.decision.runner === RunnerNames.Codex) {
      if (!executorSelection?.model || executorSelection.model.accessMode !== AccessModes.CodexCli) {
        throw new Error(
          `Codex runner selected for ${params.stepId}, but no matching codex-cli model is available in .kiwi/model-registry.yaml`,
        );
      }
      if (!executorSelection.model.providerModel) {
        throw new Error(
          `Codex model '${executorSelection.model.id}' must define providerModel for enforced model switching`,
        );
      }
    }

    return {
      runnerAdapter: params.runnerResolution.buildAdapter(params.decision.runner, executorSelection?.model),
      selectedModel: executorSelection?.model ?? null,
      selectedModelId: executorSelection?.model?.id ?? null,
      executorSelectionReason: executorSelection?.reason ?? null,
    };
  }

  previewSelection(params: {
    decision: SchedulerDecision;
    isResearchStep: boolean;
    registryModels: ModelEntry[];
    policy: KiwiPolicy;
    runnerResolution: RunnerResolution | null;
  }): StepPreviewSelection {
    if (params.decision.status !== "scheduled") {
      return { selectedModel: null, selectedModelId: null, reason: null };
    }
    if (params.isResearchStep && !this.policyResolver.useProviderResearch()) {
      return { selectedModel: null, selectedModelId: "local-researcher", reason: "local_researcher" };
    }
    if (params.isResearchStep) {
      const selected = new ResearcherProviderRegistry().select({
        registryModels: params.registryModels,
        preferenceByRole: params.policy.routing.providerPreference,
      });

      return {
        selectedModel: selected?.model ?? null,
        selectedModelId: selected?.model.id ?? null,
        reason: selected ? "researcher_provider" : "no_model_available",
      };
    }
    const selection = params.runnerResolution?.selectExecutorModel(params.decision.modelCapability);

    return {
      selectedModel: selection?.model ?? null,
      selectedModelId: selection?.model?.id ?? null,
      reason: selection?.reason ?? null,
    };
  }
}
