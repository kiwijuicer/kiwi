import {
  AnthropicPlannerProvider,
  ClaudeCodeCliPlannerProvider,
  PlannerProvider,
  StubPlannerProvider,
} from "@kiwi/adapters";
import { ContractValues, ModelEntry } from "@kiwi/contracts";
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

export function resolvePlannerProvider(options: ResolvePlannerProviderOptions): PlannerResolution {
  const env = options.env ?? process.env;
  const candidates = options.registryModels.filter(
    (model) =>
      model.roles.includes(ContractValues.Planner) &&
      (model.capability === ContractValues.Frontier || model.capability === ContractValues.Strong),
  );
  const selected =
    selectEnabledModelByAccessMode({ candidates, env }) ??
    selectEnabledModelByAccessMode({ candidates: options.registryModels.filter((model) => model.roles.includes(ContractValues.Planner)), env });

  if (!selected) {
    throw new Error("No enabled planner model with an available access mode found in model-registry.yaml");
  }

  const { model } = selected;
  if (model.accessMode === "anthropic-api") {
    return {
      provider: new AnthropicPlannerProvider({ model: model.id, env }),
      model,
      accessMode: model.accessMode,
    };
  }
  if (model.accessMode === "claude-code-cli") {
    return {
      provider: new ClaudeCodeCliPlannerProvider({ model: model.id, env }),
      model,
      accessMode: model.accessMode,
    };
  }
  if (model.accessMode === "stub") {
    const now = options.now ?? (() => new Date());
    return {
      provider: new StubPlannerProvider({
        buildTaskGraph: buildDeterministicTaskGraph,
        now,
        ...(options.planIdSuffix ? { planIdSuffix: options.planIdSuffix } : {}),
      }),
      model,
      accessMode: model.accessMode,
    };
  }
  throw new Error(`Planner access mode '${model.accessMode}' is not supported yet (modelId: ${model.id}).`);
}
