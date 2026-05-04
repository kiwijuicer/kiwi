import {
  ClaudeCodeRunnerAdapter,
  CursorAgentRunnerAdapter,
  LocalShellRunnerAdapter,
  RunnerAdapter,
} from "@kiwi/adapters";
import { AccessMode, AccessModes, ContractValues, ModelEntry, RunnerName, RunnerNames, Step } from "@kiwi/contracts";
import { AccessModeAvailability, evaluateAccessModeAvailability } from "./access-mode-resolver";

export interface RunnerResolutionOptions {
  registryModels: ModelEntry[];
  step: Step;
  env?: Record<string, string | undefined>;
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
  buildAdapter(runner: RunnerName): RunnerAdapter;
  selectedExecutorModel: ModelEntry | null;
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
const DEFAULT_RUNNER_PRIORITY: RunnerName[] = [
  RunnerNames.LocalShell,
  RunnerNames.CursorAgent,
  RunnerNames.ClaudeCode,
];

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
          ...(selectedExecutorModel ? { model: selectedExecutorModel.id } : {}),
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
          ...(selectedExecutorModel?.accessMode === AccessModes.CursorAgentCli ? { model: selectedExecutorModel.id } : {}),
          env,
        }),
    },
  ];
}

function pickExecutorModel(models: ModelEntry[], env: Record<string, string | undefined>): ModelEntry | null {
  const enabled = models.filter(
    (model) =>
      model.enabled &&
      model.roles.includes(ContractValues.Executor) &&
      (model.capability === ContractValues.Strong || model.capability === ContractValues.Mid),
  );
  for (const accessMode of EXECUTOR_ACCESS_MODE_ORDER) {
    const candidate = enabled.find((entry) => entry.accessMode === accessMode);
    if (candidate && evaluateAccessModeAvailability(accessMode, env).available) return candidate;
  }
  const stub = enabled.find((entry) => entry.accessMode === AccessModes.Stub);
  return stub ?? null;
}

function priorityForStep(step: Step): RunnerName[] {
  return CODING_STEP_TYPES.has(step.type) ? CODING_RUNNER_PRIORITY : DEFAULT_RUNNER_PRIORITY;
}

export class RunnerRegistry {
  private readonly definitions: RunnerDefinition[];

  constructor(options: RunnerRegistryOptions = {}) {
    this.definitions = options.definitions ?? defaultRunnerDefinitions();
  }

  resolve(options: RunnerResolutionOptions): RunnerResolution {
    const env = options.env ?? process.env;
    const details = this.definitions.map((definition) => definition.availability({ env }));
    const priority = priorityForStep(options.step);
    const runnerAvailability = details
      .filter((entry) => entry.available)
      .map((entry) => entry.runner)
      .sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
    const selectedExecutorModel = pickExecutorModel(options.registryModels, env);

    return {
      runnerAvailability,
      runnerAvailabilityDetails: details,
      buildAdapter: (runner) => this.buildAdapter(runner, { env, selectedExecutorModel }),
      selectedExecutorModel,
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
