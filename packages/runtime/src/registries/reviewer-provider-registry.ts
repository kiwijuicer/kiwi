import {
  AnthropicReviewerProvider,
  ClaudeCodeCliReviewerProvider,
  CodexCliReviewerProvider,
  CursorAgentReviewerProvider,
  ReviewerProvider,
} from "@kiwi/adapters";
import { AccessModes, ContractValues, KiwiPolicy, ModelCapability, ModelEntry } from "@kiwi/contracts";
import { selectEnabledModelByAccessMode } from "./access-mode-resolver";

export interface ReviewerProviderSelection {
  model: ModelEntry;
  provider: ReviewerProvider;
}

export interface ReviewerProviderRegistrySelectOptions {
  registryModels: ModelEntry[];
  policy: KiwiPolicy;
  env?: Record<string, string | undefined>;
  requestedCapability: ModelCapability;
}

const CAPABILITY_RANK: Record<ModelCapability, number> = {
  cheap: 0,
  mid: 1,
  strong: 2,
  frontier: 3,
};

export class ReviewerProviderRegistry {
  select(options: ReviewerProviderRegistrySelectOptions): ReviewerProviderSelection | null {
    const env = options.env ?? process.env;
    const candidates = this.pickCandidates(options.registryModels, options.requestedCapability);
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

  hasAvailableReviewer(options: Omit<ReviewerProviderRegistrySelectOptions, "requestedCapability">): boolean {
    return ([ContractValues.Frontier, ContractValues.Strong, ContractValues.Mid, ContractValues.Cheap] as const).some(
      (requestedCapability) => this.select({ ...options, requestedCapability }) !== null,
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

  pickCandidates(models: ModelEntry[], requestedCapability: ModelCapability): ModelEntry[] {
    const reviewers = models.filter((model) => model.roles.includes(ContractValues.Reviewer));
    const minimumRank = CAPABILITY_RANK[requestedCapability];

    return reviewers
      .filter((model) => CAPABILITY_RANK[model.capability] >= minimumRank)
      .sort((a, b) => CAPABILITY_RANK[a.capability] - CAPABILITY_RANK[b.capability]);
  }
}
