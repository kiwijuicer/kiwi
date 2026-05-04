import {
  ClaudeCodeRunnerAdapter,
  CursorAgentRunnerAdapter,
  LocalShellRunnerAdapter,
  RunnerAdapter,
} from "@kiwi/adapters";
import { AccessMode, AccessModes, ContractValues, ModelEntry, RunnerName, RunnerNames, Step } from "@kiwi/contracts";
import { evaluateAccessModeAvailability } from "./access-mode-resolver";

export interface RunnerResolutionOptions {
  registryModels: ModelEntry[];
  step: Step;
  env?: Record<string, string | undefined>;
}

export interface RunnerResolution {
  runnerAvailability: RunnerName[];
  runnerAvailabilityDetails: Array<{
    runner: RunnerName;
    accessMode: AccessMode | "local-shell";
    available: boolean;
    reason?: string;
  }>;
  buildAdapter(runner: RunnerName): RunnerAdapter;
  selectedExecutorModel: ModelEntry | null;
}

function pickExecutorModel(models: ModelEntry[], env: Record<string, string | undefined>): ModelEntry | null {
  const enabled = models.filter(
    (model) =>
      model.enabled &&
      model.roles.includes(ContractValues.Executor) &&
      (model.capability === ContractValues.Strong || model.capability === ContractValues.Mid),
  );
  const accessModeOrder = [
    AccessModes.ClaudeCodeCli,
    AccessModes.CodexCli,
    AccessModes.CursorAgentCli,
    AccessModes.AnthropicApi,
  ] as const;
  for (const accessMode of accessModeOrder) {
    const candidate = enabled.find((entry) => entry.accessMode === accessMode);
    if (candidate && evaluateAccessModeAvailability(accessMode, env).available) return candidate;
  }
  const stub = enabled.find((entry) => entry.accessMode === AccessModes.Stub);
  return stub ?? null;
}

export function resolveRunner(options: RunnerResolutionOptions): RunnerResolution {
  const env = options.env ?? process.env;
  const claudeAvailability = evaluateAccessModeAvailability(AccessModes.ClaudeCodeCli, env);
  const cursorAvailability = evaluateAccessModeAvailability(AccessModes.CursorAgentCli, env);
  const isCoding = ["coding", "code_creation", "code_modification", "refactoring"].includes(options.step.type);
  const details: RunnerResolution["runnerAvailabilityDetails"] = [
    { runner: RunnerNames.LocalShell, accessMode: "local-shell", available: true },
    {
      runner: RunnerNames.ClaudeCode,
      accessMode: AccessModes.ClaudeCodeCli,
      available: claudeAvailability.available,
      ...(claudeAvailability.reason ? { reason: claudeAvailability.reason } : {}),
    },
    {
      runner: RunnerNames.CursorAgent,
      accessMode: AccessModes.CursorAgentCli,
      available: cursorAvailability.available,
      ...(cursorAvailability.reason ? { reason: cursorAvailability.reason } : {}),
    },
  ];
  const availability = details.filter((entry) => entry.available).map((entry) => entry.runner);
  const priority: RunnerName[] = isCoding
    ? [RunnerNames.ClaudeCode, RunnerNames.Codex, RunnerNames.CursorAgent, RunnerNames.LocalShell]
    : [RunnerNames.LocalShell, RunnerNames.CursorAgent, RunnerNames.ClaudeCode];
  availability.sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
  const executor = pickExecutorModel(options.registryModels, env);
  return {
    runnerAvailability: availability,
    runnerAvailabilityDetails: details,
    buildAdapter(runner: RunnerName): RunnerAdapter {
      if (runner === RunnerNames.ClaudeCode) {
        return new ClaudeCodeRunnerAdapter({
          ...(executor ? { model: executor.id } : {}),
          env,
        });
      }
      if (runner === RunnerNames.CursorAgent) {
        return new CursorAgentRunnerAdapter({
          ...(executor && executor.accessMode === AccessModes.CursorAgentCli ? { model: executor.id } : {}),
          env,
        });
      }
      if (runner === RunnerNames.LocalShell) {
        return new LocalShellRunnerAdapter();
      }
      throw new Error(`Runner '${runner}' has no adapter wiring yet.`);
    },
    selectedExecutorModel: executor,
  };
}
