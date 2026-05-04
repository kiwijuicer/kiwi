import { describe, expect, it } from "vitest";
import { ModelEntry, Step } from "@kiwi/contracts";
import { resolveRunner } from "../runner-resolution";

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

  it("does not advertise unimplemented api runner adapters", () => {
    const resolution = resolveRunner({
      registryModels: [],
      step: codingStep,
      env: { PATH: "/empty" },
    });

    expect(resolution.runnerAvailability).toEqual(["local-shell"]);
    expect(() => resolution.buildAdapter("api")).toThrow("has no adapter wiring yet");
  });
});
