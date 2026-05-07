import {
  AnthropicPlannerProvider,
  ClaudeCodeCliPlannerProvider,
  PlannerProvider,
  StubPlannerProvider,
} from "@kiwi/adapters";
import { AccessModes, ContractValues, ModelEntry } from "@kiwi/contracts";
import { buildDeterministicTaskGraph } from "@kiwi/core";
import { selectEnabledModelByAccessMode } from "./access-mode-resolver";

export interface PlannerResolution {
  provider: PlannerProvider;
  model: ModelEntry;
  accessMode: ModelEntry["accessMode"];
}

export interface ResolvePlannerProviderOptions {
  registryModels: ModelEntry[];
  env?: Record<string, string | undefined>;
  now?: () => Date;
  planIdSuffix?: string;
}

export class PlannerProviderRegistry {
  resolve(options: ResolvePlannerProviderOptions): PlannerResolution {
    const env = options.env ?? process.env;
    const candidates = options.registryModels.filter(
      (model) =>
        model.roles.includes(ContractValues.Planner) &&
        (model.capability === ContractValues.Frontier || model.capability === ContractValues.Strong),
    );
    const fallbackCandidates = options.registryModels.filter((model) => model.roles.includes(ContractValues.Planner));
    const selected =
      selectEnabledModelByAccessMode({ candidates, env }) ??
      selectEnabledModelByAccessMode({ candidates: fallbackCandidates, env });

    if (!selected) {
      throw new Error("No enabled planner model with an available access mode found in .kiwi/model-registry.yaml");
    }

    return {
      provider: this.buildProvider(selected.model, env, options),
      model: selected.model,
      accessMode: selected.model.accessMode,
    };
  }

  buildProvider(
    model: ModelEntry,
    env: Record<string, string | undefined>,
    options: Pick<ResolvePlannerProviderOptions, "now" | "planIdSuffix"> = {},
  ): PlannerProvider {
    if (model.accessMode === AccessModes.AnthropicApi) {
      return new AnthropicPlannerProvider({ model: model.providerModel ?? model.id, env });
    }
    if (model.accessMode === AccessModes.ClaudeCodeCli) {
      return new ClaudeCodeCliPlannerProvider({
        ...(model.providerModel ? { model: model.providerModel } : {}),
        env,
      });
    }
    if (model.accessMode === AccessModes.Stub) {
      const now = options.now ?? (() => new Date());
      return new StubPlannerProvider({
        buildTaskGraph: buildDeterministicTaskGraph,
        now,
        ...(options.planIdSuffix ? { planIdSuffix: options.planIdSuffix } : {}),
      });
    }
    throw new Error(`Planner access mode '${model.accessMode}' is not supported yet (modelId: ${model.id}).`);
  }
}
