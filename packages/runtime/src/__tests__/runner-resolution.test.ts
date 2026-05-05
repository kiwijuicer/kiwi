import { describe, expect, it } from "vitest";
import { ModelEntry, Step } from "@kiwi/contracts";
import { RunnerAdapter, RunnerExecutionInput, RunnerExecutionOutput } from "@kiwi/adapters";
import { RunnerRegistry } from "../runner-registry";
import { resolveRunner } from "../runner-resolution";

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

const models: ModelEntry[] = [
  {
    id: "codex-cli-auto",
    provider: "local",
    capability: "strong",
    roles: ["executor"],
    enabled: true,
    accessMode: "codex-cli",
  },
  {
    id: "cursor-agent-auto",
    provider: "local",
    capability: "strong",
    roles: ["executor"],
    enabled: true,
    accessMode: "cursor-agent-cli",
  },
];

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

  it("does not advertise unimplemented api runner adapters", () => {
    const resolution = resolveRunner({
      registryModels: [],
      step: codingStep,
      env: { PATH: "/empty" },
    });

    expect(resolution.runnerAvailability).toEqual(["local-shell"]);
    expect(() => resolution.buildAdapter("api")).toThrow("has no adapter wiring yet");
  });

  it("forces hermetic local-shell execution when stub access mode is selected", () => {
    const resolution = resolveRunner({
      registryModels: models,
      step: codingStep,
      env: {
        KIWI_FAKE_BINARY_AVAILABLE: "1",
        KIWI_FORCE_ACCESS_MODE: "stub",
      },
    });

    expect(resolution.runnerAvailability).toEqual(["local-shell"]);
    expect(resolution.runnerAvailabilityDetails).toContainEqual({
      runner: "claude-code",
      accessMode: "claude-code-cli",
      available: false,
      reason: "KIWI_FORCE_ACCESS_MODE=stub",
    });
    expect(resolution.buildAdapter("local-shell").name).toBe("local-shell");
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
      registryModels: [],
      step: codingStep,
      env: { PATH: "/empty" },
    });

    expect(resolution.runnerAvailability).toEqual(["codex"]);
    expect(resolution.runnerAvailabilityDetails).toEqual([
      { runner: "codex", accessMode: "codex-cli", available: true },
    ]);
    expect(resolution.buildAdapter("codex").name).toBe("codex");
  });
});
