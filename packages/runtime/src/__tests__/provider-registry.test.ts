import { describe, expect, it } from "vitest";
import { KiwiPolicy, ModelEntry } from "@kiwi/contracts";
import { PlannerProviderRegistry } from "../planner-provider-registry";
import { ResearcherProviderRegistry } from "../researcher-provider-registry";
import { ReviewerProviderRegistry } from "../reviewer-provider-registry";

const policy: KiwiPolicy = {
  version: "1",
  project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
  commands: { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
  routing: { defaultAgentRole: "executor", defaultModelCapability: "strong", stepTypeOverrides: {} },
  riskZones: { high: [] },
  approvals: { requireFor: [], commandApprovalStates: {} },
  commandProfiles: {},
};

describe("provider registries", () => {
  it("keeps planner resolver behavior while delegating provider construction", () => {
    const models: ModelEntry[] = [
      {
        id: "stub-frontier",
        provider: "stub",
        capability: "frontier",
        roles: ["planner"],
        accessMode: "stub",
        enabled: true,
      },
    ];

    const resolution = new PlannerProviderRegistry().resolve({
      registryModels: models,
      env: { PATH: "/empty" },
    });

    expect(resolution.model.id).toBe("stub-frontier");
    expect(resolution.provider.name).toBe("stub-deterministic");
  });

  it("selects reviewer providers only when a real access mode is available", () => {
    const models: ModelEntry[] = [
      {
        id: "claude-opus-4-6",
        provider: "anthropic",
        capability: "frontier",
        roles: ["reviewer"],
        accessMode: "anthropic-api",
        enabled: true,
      },
    ];
    const registry = new ReviewerProviderRegistry();

    expect(registry.select({ registryModels: models, policy, env: { PATH: "/empty" } })).toBeNull();
    expect(
      registry.select({
        registryModels: models,
        policy,
        env: { ANTHROPIC_API_KEY: "sk-ant-test" },
      })?.provider.name,
    ).toBe("anthropic:claude-opus-4-6");
  });

  it("selects mid researcher providers with stub fallback", () => {
    const models: ModelEntry[] = [
      {
        id: "stub-mid",
        provider: "stub",
        capability: "mid",
        roles: ["researcher"],
        accessMode: "stub",
        enabled: true,
      },
    ];

    const selected = new ResearcherProviderRegistry().select({ registryModels: models, env: { PATH: "/empty" } });

    expect(selected?.model.id).toBe("stub-mid");
    expect(selected?.provider.name).toBe("stub-researcher");
  });
});
