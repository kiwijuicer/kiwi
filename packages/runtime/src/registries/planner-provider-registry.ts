import {
  AnthropicPlannerProvider,
  ClaudeCodeCliPlannerProvider,
  CodexCliPlannerProvider,
  CursorAgentPlannerProvider,
  PlannerProvider,
  StubPlannerProvider,
} from "@kiwi/adapters";
import { AccessModes, ContractValues, ModelEntry, ProviderPreference } from "@kiwi/contracts";
import { buildDeterministicTaskGraph } from "@kiwi/core";
import { evaluateAccessModeAvailability, selectEnabledModelByAccessMode } from "./access-mode-resolver";

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
  allowStub?: boolean;
  preferenceByRole?: ProviderPreference | undefined;
}

function stubAllowed(options: ResolvePlannerProviderOptions, env: Record<string, string | undefined>): boolean {
  return options.allowStub === true || env.KIWI_ALLOW_STUB === "1" || env.KIWI_FORCE_ACCESS_MODE === AccessModes.Stub;
}

function formatPlannerAvailability(candidates: ModelEntry[], env: Record<string, string | undefined>): string {
  const rows = candidates
    .filter((model) => model.enabled)
    .map((model) => {
      if (model.accessMode === AccessModes.Stub) {
        return `  - ${model.id} (${model.accessMode}): disabled by default`;
      }
      const availability = evaluateAccessModeAvailability(model.accessMode, env);
      const status = availability.available
        ? "available"
        : `unavailable${availability.reason ? ` - ${availability.reason}` : ""}`;

      return `  - ${model.id} (${model.accessMode}): ${status}`;
    });

  return rows.length > 0 ? rows.join("\n") : "  - no enabled planner models";
}

function plannerPriority(model: ModelEntry): number {
  if (model.capability === ContractValues.Frontier) {
    return 0;
  }
  if (model.capability === ContractValues.Strong) {
    return 1;
  }

  return 2;
}

function byPlannerCapability(a: ModelEntry, b: ModelEntry): number {
  return plannerPriority(a) - plannerPriority(b);
}

export class PlannerProviderRegistry {
  resolve(options: ResolvePlannerProviderOptions): PlannerResolution {
    const env = options.env ?? process.env;
    const allowStub = stubAllowed(options, env);
    const candidates = options.registryModels
      .filter(
        (model) =>
          model.roles.includes(ContractValues.Planner) &&
          (model.capability === ContractValues.Frontier || model.capability === ContractValues.Strong),
      )
      .sort(byPlannerCapability);
    const fallbackCandidates = options.registryModels
      .filter((model) => model.roles.includes(ContractValues.Planner))
      .sort(byPlannerCapability);
    const selected =
      selectEnabledModelByAccessMode({
        candidates,
        env,
        allowStub,
        excludeStub: !allowStub,
        role: ContractValues.Planner,
        preferenceByRole: options.preferenceByRole,
      }) ??
      selectEnabledModelByAccessMode({
        candidates: fallbackCandidates,
        env,
        allowStub,
        excludeStub: !allowStub,
        role: ContractValues.Planner,
        preferenceByRole: options.preferenceByRole,
      });

    if (!selected) {
      throw new Error(
        [
          "No real planner model with an available access mode found in the effective model registry",
          "checked:",
          formatPlannerAvailability(fallbackCandidates, env),
          "Stub planning is disabled by default; use --allow-stub or KIWI_ALLOW_STUB=1 only for tests/dev.",
        ].join("\n"),
      );
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
    if (model.accessMode === AccessModes.CodexCli) {
      if (!model.providerModel) {
        throw new Error(`Codex planner model '${model.id}' must define providerModel for enforced model switching`);
      }

      return new CodexCliPlannerProvider({
        model: model.providerModel,
        env,
      });
    }
    if (model.accessMode === AccessModes.CursorAgentCli) {
      return new CursorAgentPlannerProvider({
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
