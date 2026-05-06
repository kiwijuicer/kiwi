import {
  AnthropicResearcherProvider,
  ClaudeCodeCliResearcherProvider,
  ResearcherProvider,
  StubResearcherProvider,
} from "@kiwi/adapters";
import { AccessModes, ContractValues, ModelEntry } from "@kiwi/contracts";
import { selectEnabledModelByAccessMode } from "./access-mode-resolver";

export interface ResearcherProviderSelection {
  model: ModelEntry;
  provider: ResearcherProvider;
}

export interface ResearcherProviderRegistrySelectOptions {
  registryModels: ModelEntry[];
  env?: Record<string, string | undefined>;
}

export class ResearcherProviderRegistry {
  select(options: ResearcherProviderRegistrySelectOptions): ResearcherProviderSelection | null {
    const env = options.env ?? process.env;
    const candidates = this.pickCandidates(options.registryModels);
    const selected = selectEnabledModelByAccessMode({ candidates, env });
    if (!selected) return null;
    return {
      model: selected.model,
      provider: this.buildProvider(selected.model, env),
    };
  }

  buildProvider(model: ModelEntry, env: Record<string, string | undefined>): ResearcherProvider {
    if (model.accessMode === AccessModes.AnthropicApi) {
      return new AnthropicResearcherProvider({ model: model.id, env });
    }
    if (model.accessMode === AccessModes.ClaudeCodeCli) {
      return new ClaudeCodeCliResearcherProvider({ model: model.id, env });
    }
    if (model.accessMode === AccessModes.Stub) {
      return new StubResearcherProvider();
    }
    throw new Error(`Researcher access mode '${model.accessMode}' is not supported yet (modelId: ${model.id}).`);
  }

  pickCandidates(models: ModelEntry[]): ModelEntry[] {
    const researchers = models.filter((model) => model.roles.includes(ContractValues.Researcher));
    const cheap = researchers.filter((model) => model.capability === ContractValues.Cheap);
    const mid = researchers.filter((model) => model.capability === ContractValues.Mid);
    const preferred = [...mid, ...cheap];
    return preferred.length > 0 ? preferred : researchers;
  }
}
