import { describe, expect, it } from "vitest";
import { ModelEntry, Step } from "@kiwi/contracts";
import { RunnerAdapter, RunnerExecutionInput, RunnerExecutionOutput } from "@kiwi/adapters";
import { RunnerRegistry } from "../../registries/runner-registry.js";
import { resolveRunner } from "../../registries/runner-resolution.js";

const zeroPricing = { currency: "USD", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } as const;

class FakeCodexAdapter implements RunnerAdapter {
  readonly name = "codex";

  execute(_input: RunnerExecutionInput): Promise<RunnerExecutionOutput> {
    throw new Error("not needed for registry construction test");
  }
}

const codingStep: Step = {
  stepId: "step_001",
  type: "coding",
  title: "Implement",
  dependsOn: [],
  successCriteria: ["done"],
  requiredGates: [],
  recommendedAgentRole: "executor",
  recommendedModelCapability: "strong",
  status: "pending",
};

const planningStep: Step = {
  ...codingStep,
  type: "planning",
  title: "Plan",
  recommendedAgentRole: "planner",
  recommendedModelCapability: "frontier",
};

const models: ModelEntry[] = [
  {
    id: "codex-cli-strong",
    providerModel: "gpt-5.4",
    provider: "local",
    capability: "strong",
    roles: ["executor"],
    enabled: true,
    accessMode: "codex-cli",
    pricing: zeroPricing,
  },
  {
    id: "cursor-agent-auto",
    provider: "local",
    capability: "strong",
    roles: ["executor"],
    enabled: true,
    accessMode: "cursor-agent-cli",
    pricing: zeroPricing,
  },
];

function executorModel(
  id: string,
  capability: ModelEntry["capability"],
  accessMode: ModelEntry["accessMode"],
): ModelEntry {
  const entry: ModelEntry = {
    id,
    provider: accessMode === "stub" ? "stub" : "local",
    capability,
    roles: ["executor"],
    enabled: true,
    accessMode,
    pricing: zeroPricing,
  };

  if (accessMode === "codex-cli") {
    entry.providerModel = capability === "frontier" ? "gpt-5.5" : "gpt-5.4";
  }

  return entry;
}

describe("runner resolution", () => {
  it("reports cursor-agent availability and builds its adapter when the local CLI is available", () => {
    const resolution = resolveRunner({
      registryModels: models,
      step: codingStep,
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.runnerAvailability).toContain("cursor-agent");
    expect(resolution.runnerAvailabilityDetails).toContainEqual({
      runner: "cursor-agent",
      accessMode: "cursor-agent-cli",
      available: true,
    });
    expect(resolution.buildAdapter("cursor-agent").name).toBe("cursor-agent");
  });

  it("reports codex availability and builds its adapter when the local CLI is available", () => {
    const resolution = resolveRunner({
      registryModels: models,
      step: codingStep,
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.runnerAvailability).toContain("codex");
    expect(resolution.runnerAvailabilityDetails).toContainEqual({
      runner: "codex",
      accessMode: "codex-cli",
      available: true,
    });
    expect(resolution.buildAdapter("codex").name).toBe("codex");
    expect(resolution.selectedExecutorModel?.accessMode).toBe("codex-cli");
  });

  it("uses executor provider preference for runner and model tie-breaks", () => {
    const resolution = resolveRunner({
      registryModels: [
        executorModel("claude-sonnet", "strong", "claude-code-cli"),
        executorModel("codex-strong", "strong", "codex-cli"),
      ],
      step: codingStep,
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
      preferenceByRole: { executor: ["codex-cli", "claude-code-cli"] },
    });

    expect(resolution.runnerAvailability[0]).toBe("codex");
    expect(resolution.selectedExecutorModel?.id).toBe("codex-strong");
  });

  it("selects replacement executor models constrained to the fallback runner", () => {
    const resolution = resolveRunner({
      registryModels: [
        executorModel("claude-sonnet", "strong", "claude-code-cli"),
        executorModel("codex-strong", "strong", "codex-cli"),
      ],
      step: codingStep,
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
      preferenceByRole: { executor: ["claude-code-cli", "codex-cli"] },
    });

    expect(resolution.selectedExecutorModel?.id).toBe("claude-sonnet");
    expect(resolution.selectExecutorModelForRunner("codex", "strong").model?.id).toBe("codex-strong");
  });

  it("honors a cheap scheduler decision before choosing stronger executor models", () => {
    const resolution = resolveRunner({
      registryModels: [
        executorModel("claude-sonnet", "strong", "claude-code-cli"),
        executorModel("codex-cheap", "cheap", "codex-cli"),
      ],
      step: codingStep,
      requestedCapability: "cheap",
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.executorSelection).toMatchObject({
      requestedCapability: "cheap",
      selectedCapability: "cheap",
      reason: "exact_match",
    });
    expect(resolution.selectedExecutorModel?.id).toBe("codex-cheap");
  });

  it("escalates to the lowest available stronger executor model", () => {
    const resolution = resolveRunner({
      registryModels: [executorModel("claude-sonnet", "strong", "claude-code-cli")],
      step: codingStep,
      requestedCapability: "cheap",
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.executorSelection).toMatchObject({
      requestedCapability: "cheap",
      selectedCapability: "strong",
      reason: "escalated_for_availability",
    });
    expect(resolution.selectedExecutorModel?.id).toBe("claude-sonnet");
  });

  it("keeps stub executor models behind available real models", () => {
    const resolution = resolveRunner({
      registryModels: [
        executorModel("stub-cheap", "cheap", "stub"),
        executorModel("claude-sonnet", "strong", "claude-code-cli"),
      ],
      step: codingStep,
      requestedCapability: "cheap",
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.executorSelection.reason).toBe("escalated_for_availability");
    expect(resolution.selectedExecutorModel?.id).toBe("claude-sonnet");
  });

  it("does not fall back to stub executor models unless explicitly enabled", () => {
    const resolution = resolveRunner({
      registryModels: [executorModel("stub-strong", "strong", "stub")],
      step: codingStep,
      requestedCapability: "strong",
      env: { PATH: "/empty", KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.executorSelection).toMatchObject({
      requestedCapability: "strong",
      selectedCapability: null,
      reason: "no_model_available",
    });
    expect(resolution.selectedExecutorModel).toBeNull();
  });

  it("falls back to a lower executor tier when no adequate model is available", () => {
    const resolution = resolveRunner({
      registryModels: [executorModel("codex-strong", "strong", "codex-cli")],
      step: codingStep,
      requestedCapability: "frontier",
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.executorSelection).toMatchObject({
      requestedCapability: "frontier",
      selectedCapability: "strong",
      reason: "fell_back_to_lower",
    });
  });

  it("does not advertise unimplemented api runner adapters", () => {
    const resolution = resolveRunner({
      registryModels: [],
      step: codingStep,
      env: { PATH: "/empty", KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.runnerAvailability).toEqual([]);
    expect(() => resolution.buildAdapter("api")).toThrow("has no adapter wiring yet");
  });

  it("prefers Codex for non-coding steps when a real Codex executor is available", () => {
    const resolution = resolveRunner({
      registryModels: models,
      step: planningStep,
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.runnerAvailability[0]).toBe("codex");
  });

  it("forces stub execution when stub access mode is selected", () => {
    const resolution = resolveRunner({
      registryModels: [executorModel("stub-strong", "strong", "stub"), ...models],
      step: codingStep,
      env: {
        KIWI_FAKE_BINARY_AVAILABLE: "1",
        KIWI_TEST_ALLOW_STUB: "1",
        KIWI_FORCE_ACCESS_MODE: "stub",
      },
    });

    expect(resolution.runnerAvailability).toEqual(["stub"]);
    expect(resolution.runnerAvailabilityDetails).toContainEqual({
      runner: "claude-code",
      accessMode: "claude-code-cli",
      available: false,
      reason: "KIWI_FORCE_ACCESS_MODE=stub",
    });
    expect(resolution.buildAdapter("stub").name).toBe("stub");
  });

  it("allows fake adapter registration without probing a real CLI", () => {
    const registry = new RunnerRegistry({
      definitions: [
        {
          runner: "codex",
          accessMode: "codex-cli",
          availability: () => ({ runner: "codex", accessMode: "codex-cli", available: true }),
          buildAdapter: () => new FakeCodexAdapter(),
        },
      ],
    });

    const resolution = registry.resolve({
      registryModels: [executorModel("codex-strong", "strong", "codex-cli")],
      step: codingStep,
      env: { PATH: "/empty", KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.runnerAvailability).toEqual(["codex"]);
    expect(resolution.runnerAvailabilityDetails).toEqual([
      { runner: "codex", accessMode: "codex-cli", available: true },
    ]);
    expect(resolution.buildAdapter("codex").name).toBe("codex");
  });
});
