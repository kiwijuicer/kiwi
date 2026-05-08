import {
  ClaudeCodeRunnerAdapter,
  CodexCliRunnerAdapter,
  CursorAgentRunnerAdapter,
  LocalShellRunnerAdapter,
  RunnerAdapter,
} from "@kiwi/adapters";
import {
  AccessMode,
  AccessModes,
  ContractValues,
  ModelCapability,
  ModelEntry,
  ProviderPreference,
  RunnerName,
  RunnerNames,
  Step,
} from "@kiwi/contracts";
import {
  AccessModeAvailability,
  accessModeOrderForRole,
  evaluateAccessModeAvailability,
  stubAccessAllowed,
} from "./access-mode-resolver";

export interface RunnerResolutionOptions {
  registryModels: ModelEntry[];
  step: Step;
  /**
   * Capability the scheduler decided on (post downgrade/escalation).
   * If omitted, falls back to `step.recommendedModelCapability`.
   */
  requestedCapability?: ModelCapability;
  env?: Record<string, string | undefined>;
  preferenceByRole?: ProviderPreference | undefined;
}

export type ExecutorSelectionReason =
  | "exact_match"
  | "escalated_for_availability"
  | "fell_back_to_lower"
  | "stub_fallback"
  | "no_model_available";

export interface ExecutorSelection {
  model: ModelEntry | null;
  requestedCapability: ModelCapability;
  selectedCapability: ModelCapability | null;
  reason: ExecutorSelectionReason;
}

export interface RunnerAvailabilityDetail {
  runner: RunnerName;
  accessMode: AccessMode | "local-shell";
  available: boolean;
  reason?: string;
}

export interface RunnerBuildContext {
  env: Record<string, string | undefined>;
  selectedExecutorModel: ModelEntry | null;
}

export interface RunnerDefinition {
  runner: RunnerName;
  accessMode: AccessMode | "local-shell";
  availability(context: { env: Record<string, string | undefined> }): RunnerAvailabilityDetail;
  buildAdapter(context: RunnerBuildContext): RunnerAdapter;
}

export interface RunnerResolution {
  runnerAvailability: RunnerName[];
  runnerAvailabilityDetails: RunnerAvailabilityDetail[];
  buildAdapter(runner: RunnerName, executorModel?: ModelEntry | null): RunnerAdapter;
  /**
   * Backwards-compatible: resolves the executor model with the step's
   * recommended capability if the caller did not supply
   * `requestedCapability`. Prefer calling {@link selectExecutorModel}
   * after the scheduler has produced its final capability decision.
   */
  selectedExecutorModel: ModelEntry | null;
  /** Detailed selection trace for the recommended capability. */
  executorSelection: ExecutorSelection;
  /** Re-run the executor selection with a different capability. */
  selectExecutorModel(requestedCapability: ModelCapability): ExecutorSelection;
}

export interface RunnerRegistryOptions {
  definitions?: RunnerDefinition[];
}

const CODING_STEP_TYPES = new Set(["coding", "code_creation", "code_modification", "refactoring"]);
const EXECUTOR_ACCESS_MODE_ORDER = [
  AccessModes.ClaudeCodeCli,
  AccessModes.CodexCli,
  AccessModes.CursorAgentCli,
  AccessModes.AnthropicApi,
] as const;
const CODING_RUNNER_PRIORITY: RunnerName[] = [
  RunnerNames.ClaudeCode,
  RunnerNames.Codex,
  RunnerNames.CursorAgent,
  RunnerNames.LocalShell,
];
const DEFAULT_RUNNER_PRIORITY: RunnerName[] = [RunnerNames.LocalShell, RunnerNames.CursorAgent, RunnerNames.ClaudeCode];

function forcedRunnerForAccessMode(accessMode: string | undefined): RunnerName | null {
  switch (accessMode) {
    case undefined:
      return null;
    case AccessModes.ClaudeCodeCli:
      return RunnerNames.ClaudeCode;
    case AccessModes.CodexCli:
      return RunnerNames.Codex;
    case AccessModes.CursorAgentCli:
      return RunnerNames.CursorAgent;
    case AccessModes.Local:
    case AccessModes.Stub:
      return RunnerNames.LocalShell;
    default:
      return null;
  }
}

function detailFromAccessMode(runner: RunnerName, availability: AccessModeAvailability): RunnerAvailabilityDetail {
  return {
    runner,
    accessMode: availability.accessMode,
    available: availability.available,
    ...(availability.reason ? { reason: availability.reason } : {}),
  };
}

function defaultRunnerDefinitions(): RunnerDefinition[] {
  return [
    {
      runner: RunnerNames.LocalShell,
      accessMode: "local-shell",
      availability: () => ({ runner: RunnerNames.LocalShell, accessMode: "local-shell", available: true }),
      buildAdapter: () => new LocalShellRunnerAdapter(),
    },
    {
      runner: RunnerNames.ClaudeCode,
      accessMode: AccessModes.ClaudeCodeCli,
      availability: ({ env }) =>
        detailFromAccessMode(RunnerNames.ClaudeCode, evaluateAccessModeAvailability(AccessModes.ClaudeCodeCli, env)),
      buildAdapter: ({ env, selectedExecutorModel }) =>
        new ClaudeCodeRunnerAdapter({
          ...(selectedExecutorModel?.providerModel ? { model: selectedExecutorModel.providerModel } : {}),
          env,
        }),
    },
    {
      runner: RunnerNames.Codex,
      accessMode: AccessModes.CodexCli,
      availability: ({ env }) =>
        detailFromAccessMode(RunnerNames.Codex, evaluateAccessModeAvailability(AccessModes.CodexCli, env)),
      buildAdapter: ({ env, selectedExecutorModel }) =>
        new CodexCliRunnerAdapter({
          ...(selectedExecutorModel?.accessMode === AccessModes.CodexCli && selectedExecutorModel.providerModel
            ? { model: selectedExecutorModel.providerModel }
            : {}),
          env,
        }),
    },
    {
      runner: RunnerNames.CursorAgent,
      accessMode: AccessModes.CursorAgentCli,
      availability: ({ env }) =>
        detailFromAccessMode(RunnerNames.CursorAgent, evaluateAccessModeAvailability(AccessModes.CursorAgentCli, env)),
      buildAdapter: ({ env, selectedExecutorModel }) =>
        new CursorAgentRunnerAdapter({
          ...(selectedExecutorModel?.accessMode === AccessModes.CursorAgentCli && selectedExecutorModel.providerModel
            ? { model: selectedExecutorModel.providerModel }
            : {}),
          env,
        }),
    },
  ];
}

const CAPABILITY_RANK: Record<ModelCapability, number> = {
  cheap: 0,
  mid: 1,
  strong: 2,
  frontier: 3,
};
const CAPABILITY_ORDER: ModelCapability[] = [
  ContractValues.Cheap,
  ContractValues.Mid,
  ContractValues.Strong,
  ContractValues.Frontier,
];

function isAccessAvailable(model: ModelEntry, env: Record<string, string | undefined>): boolean {
  if (env.KIWI_FORCE_ACCESS_MODE && model.accessMode !== env.KIWI_FORCE_ACCESS_MODE) return false;
  if (model.accessMode === AccessModes.Stub) return stubAccessAllowed(env);
  return evaluateAccessModeAvailability(model.accessMode, env).available;
}

function preferAccessOrder(params: {
  candidates: ModelEntry[];
  env: Record<string, string | undefined>;
  preferenceByRole?: ProviderPreference | undefined;
}): ModelEntry | null {
  const order = accessModeOrderForRole({
    env: params.env,
    role: ContractValues.Executor,
    preferenceByRole: params.preferenceByRole,
    preferOrder: [...EXECUTOR_ACCESS_MODE_ORDER],
  });
  for (const accessMode of order) {
    const candidate = params.candidates.find((entry) => entry.accessMode === accessMode);
    if (candidate && isAccessAvailable(candidate, params.env)) return candidate;
  }
  return null;
}

function preferCapabilityAndAccessOrder(params: {
  candidates: ModelEntry[];
  capabilities: ModelCapability[];
  env: Record<string, string | undefined>;
  preferenceByRole?: ProviderPreference | undefined;
}): ModelEntry | null {
  for (const capability of params.capabilities) {
    const pick = preferAccessOrder({
      candidates: params.candidates.filter((entry) => entry.capability === capability),
      env: params.env,
      preferenceByRole: params.preferenceByRole,
    });
    if (pick) return pick;
  }
  return null;
}

function preferStub(candidates: ModelEntry[], requested: ModelCapability): ModelEntry | null {
  const requestedRank = CAPABILITY_RANK[requested];
  const atOrAbove = CAPABILITY_ORDER.filter((capability) => CAPABILITY_RANK[capability] >= requestedRank);
  const below = CAPABILITY_ORDER.filter((capability) => CAPABILITY_RANK[capability] < requestedRank).reverse();
  for (const capability of [...atOrAbove, ...below]) {
    const pick = candidates.find((entry) => entry.capability === capability);
    if (pick) return pick;
  }
  return null;
}

/**
 * Pick the cheapest enabled executor model whose capability is at least
 * `requested` and whose access mode is available. Falls back to a lower
 * tier and finally to stub if nothing matches.
 */
function pickExecutorModel(
  models: ModelEntry[],
  env: Record<string, string | undefined>,
  requested: ModelCapability,
  preferenceByRole?: ProviderPreference | undefined,
): ExecutorSelection {
  const enabled = models.filter((model) => model.enabled && model.roles.includes(ContractValues.Executor));
  if (enabled.length === 0) {
    return {
      model: null,
      requestedCapability: requested,
      selectedCapability: null,
      reason: "no_model_available",
    };
  }
  const requestedRank = CAPABILITY_RANK[requested];
  const nonStub = enabled.filter((model) => model.accessMode !== AccessModes.Stub);
  const stubs = enabled.filter((model) => model.accessMode === AccessModes.Stub);

  const atOrAbove = CAPABILITY_ORDER.filter((capability) => CAPABILITY_RANK[capability] >= requestedRank);
  const adequatePick = preferCapabilityAndAccessOrder({ candidates: nonStub, capabilities: atOrAbove, env, preferenceByRole });
  if (adequatePick) {
    return {
      model: adequatePick,
      requestedCapability: requested,
      selectedCapability: adequatePick.capability,
      reason: adequatePick.capability === requested ? "exact_match" : "escalated_for_availability",
    };
  }

  const below = CAPABILITY_ORDER.filter((capability) => CAPABILITY_RANK[capability] < requestedRank).reverse();
  const lowerPick = preferCapabilityAndAccessOrder({ candidates: nonStub, capabilities: below, env, preferenceByRole });
  if (lowerPick) {
    return {
      model: lowerPick,
      requestedCapability: requested,
      selectedCapability: lowerPick.capability,
      reason: "fell_back_to_lower",
    };
  }

  const stubAvailable = stubAccessAllowed(env);
  const stub = stubAvailable ? preferStub(stubs, requested) : null;
  if (stub) {
    return {
      model: stub,
      requestedCapability: requested,
      selectedCapability: stub.capability,
      reason: "stub_fallback",
    };
  }

  return {
    model: null,
    requestedCapability: requested,
    selectedCapability: null,
    reason: "no_model_available",
  };
}

function runnerForAccessMode(accessMode: AccessMode): RunnerName | null {
  if (accessMode === AccessModes.ClaudeCodeCli) return RunnerNames.ClaudeCode;
  if (accessMode === AccessModes.CodexCli) return RunnerNames.Codex;
  if (accessMode === AccessModes.CursorAgentCli) return RunnerNames.CursorAgent;
  if (accessMode === AccessModes.Local || accessMode === AccessModes.Stub) return RunnerNames.LocalShell;
  return null;
}

function priorityForStep(step: Step, preferenceByRole?: ProviderPreference | undefined): RunnerName[] {
  const base = CODING_STEP_TYPES.has(step.type) ? CODING_RUNNER_PRIORITY : DEFAULT_RUNNER_PRIORITY;
  const preferred = (preferenceByRole?.[ContractValues.Executor] ?? [])
    .map((accessMode) => runnerForAccessMode(accessMode))
    .filter((entry): entry is RunnerName => entry !== null);
  if (preferred.length === 0) return base;
  return [...preferred, ...base.filter((entry) => !preferred.includes(entry))];
}

function priorityIndex(priority: RunnerName[], runner: RunnerName): number {
  const index = priority.indexOf(runner);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export class RunnerRegistry {
  private readonly definitions: RunnerDefinition[];

  constructor(options: RunnerRegistryOptions = {}) {
    this.definitions = options.definitions ?? defaultRunnerDefinitions();
  }

  resolve(options: RunnerResolutionOptions): RunnerResolution {
    const env = options.env ?? process.env;
    const forcedRunner = forcedRunnerForAccessMode(env.KIWI_FORCE_ACCESS_MODE);
    const details = this.definitions.map((definition) => {
      if (!forcedRunner || definition.runner === forcedRunner) return definition.availability({ env });
      return {
        runner: definition.runner,
        accessMode: definition.accessMode,
        available: false,
        reason: `KIWI_FORCE_ACCESS_MODE=${env.KIWI_FORCE_ACCESS_MODE}`,
      };
    });
    const priority = priorityForStep(options.step, options.preferenceByRole);
    const runnerAvailability = details
      .filter((entry) => entry.available)
      .map((entry) => entry.runner)
      .sort((a, b) => priorityIndex(priority, a) - priorityIndex(priority, b));
    const requestedCapability = options.requestedCapability ?? options.step.recommendedModelCapability;
    const executorSelection = pickExecutorModel(
      options.registryModels,
      env,
      requestedCapability,
      options.preferenceByRole,
    );
    const selectExecutorModel = (capability: ModelCapability): ExecutorSelection =>
      pickExecutorModel(options.registryModels, env, capability, options.preferenceByRole);

    return {
      runnerAvailability,
      runnerAvailabilityDetails: details,
      buildAdapter: (runner, executorModel) =>
        this.buildAdapter(runner, { env, selectedExecutorModel: executorModel ?? null }),
      selectedExecutorModel: executorSelection.model,
      executorSelection,
      selectExecutorModel,
    };
  }

  buildAdapter(runner: RunnerName, context: RunnerBuildContext): RunnerAdapter {
    const definition = this.definitions.find((entry) => entry.runner === runner);
    if (!definition) {
      throw new Error(`Runner '${runner}' has no adapter wiring yet.`);
    }
    return definition.buildAdapter(context);
  }
}
