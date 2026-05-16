import {
  AnthropicReviewerProvider,
  ClaudeCodeCliReviewerProvider,
  CodexCliReviewerProvider,
  CursorAgentReviewerProvider,
  ReviewerProvider,
} from "@kiwi/adapters";
import { AccessModes, ContractValues, KiwiPolicy, ModelEntry } from "@kiwi/contracts";
import { selectEnabledModelByAccessMode } from "./access-mode-resolver";

export interface ReviewerProviderSelection {
  model: ModelEntry;
  provider: ReviewerProvider;
}

export interface ReviewerProviderRegistrySelectOptions {
  registryModels: ModelEntry[];
  policy: KiwiPolicy;
  env?: Record<string, string | undefined>;
  riskHigh?: boolean;
}

export class ReviewerProviderRegistry {
  select(options: ReviewerProviderRegistrySelectOptions): ReviewerProviderSelection | null {
    const env = options.env ?? process.env;
    const candidates = this.pickCandidates(options.registryModels, options.riskHigh ?? false);
    const selected = selectEnabledModelByAccessMode({
      candidates,
      env,
      excludeStub: true,
      role: ContractValues.Reviewer,
      preferenceByRole: options.policy.routing.providerPreference,
    });

    if (!selected) {
      return null;
    }

    return {
      model: selected.model,
      provider: this.buildProvider(selected.model, env, options.policy),
    };
  }

  hasAvailableReviewer(options: Omit<ReviewerProviderRegistrySelectOptions, "riskHigh">): boolean {
    return (
      this.select({ ...options, riskHigh: true }) !== null || this.select({ ...options, riskHigh: false }) !== null
    );
  }

  buildProvider(model: ModelEntry, env: Record<string, string | undefined>, policy: KiwiPolicy): ReviewerProvider {
    if (model.accessMode === AccessModes.AnthropicApi) {
      return new AnthropicReviewerProvider({ model: model.providerModel ?? model.id, env, policy });
    }
    if (model.accessMode === AccessModes.ClaudeCodeCli) {
      return new ClaudeCodeCliReviewerProvider({
        ...(model.providerModel ? { model: model.providerModel } : {}),
        env,
        policy,
      });
    }
    if (model.accessMode === AccessModes.CodexCli) {
      if (!model.providerModel) {
        throw new Error(`Codex reviewer model '${model.id}' must define providerModel for enforced model switching`);
      }

      return new CodexCliReviewerProvider({
        model: model.providerModel,
        env,
        policy,
      });
    }
    if (model.accessMode === AccessModes.CursorAgentCli) {
      return new CursorAgentReviewerProvider({
        ...(model.providerModel ? { model: model.providerModel } : {}),
        env,
        policy,
      });
    }
    throw new Error(`Reviewer access mode '${model.accessMode}' is not supported yet (modelId: ${model.id}).`);
  }

  pickCandidates(models: ModelEntry[], riskHigh: boolean): ModelEntry[] {
    const reviewers = models.filter((model) => model.roles.includes(ContractValues.Reviewer));
    const targetCapability = riskHigh ? ContractValues.Frontier : ContractValues.Strong;
    const exact = reviewers.filter((model) => model.capability === targetCapability);

    if (exact.length > 0) {
      return exact;
    }
    const frontier = reviewers.filter((model) => model.capability === ContractValues.Frontier);

    if (frontier.length > 0) {
      return frontier;
    }
    const strong = reviewers.filter((model) => model.capability === ContractValues.Strong);

    if (strong.length > 0) {
      return strong;
    }

    return reviewers;
  }
}
