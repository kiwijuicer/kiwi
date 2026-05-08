import { describe, expect, it } from "vitest";
import { KiwiPolicy, ModelEntry } from "@kiwi/contracts";
import { PlannerProviderRegistry } from "../planner-provider-registry";
import { ResearcherProviderRegistry } from "../researcher-provider-registry";
import { ReviewerProviderRegistry } from "../reviewer-provider-registry";

const policy: KiwiPolicy = {
  version: "1",
  project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
  commands: { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
  routing: { defaultAgentRole: "executor", defaultModelCapability: "strong", providerPreference: {}, stepTypeOverrides: {} },
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
      allowStub: true,
    });

    expect(resolution.model.id).toBe("stub-frontier");
    expect(resolution.provider.name).toBe("stub-deterministic");
  });

  it("does not select a stub planner unless explicitly allowed", () => {
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

    expect(() =>
      new PlannerProviderRegistry().resolve({
        registryModels: models,
        env: { PATH: "/empty" },
      }),
    ).toThrow(/No real planner model[\s\S]*stub-frontier \(stub\): disabled by default/);
  });

  it("passes providerModel to Claude Code providers while keeping stable local ids", () => {
    const models: ModelEntry[] = [
      {
        id: "claude-code-cli-frontier",
        providerModel: "opus",
        provider: "anthropic",
        capability: "frontier",
        roles: ["planner"],
        accessMode: "claude-code-cli",
        enabled: true,
      },
    ];

    const resolution = new PlannerProviderRegistry().resolve({
      registryModels: models,
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.model.id).toBe("claude-code-cli-frontier");
    expect(resolution.provider.name).toBe("claude-code-cli:opus");
  });

  it("lets Claude Code CLI resolve its default model when providerModel is omitted", () => {
    const models: ModelEntry[] = [
      {
        id: "claude-code-cli-frontier",
        provider: "anthropic",
        capability: "frontier",
        roles: ["planner"],
        accessMode: "claude-code-cli",
        enabled: true,
      },
    ];

    const resolution = new PlannerProviderRegistry().resolve({
      registryModels: models,
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.provider.name).toBe("claude-code-cli:default");
  });

  it("uses Codex CLI as a real planner fallback when Claude is unavailable", () => {
    const models: ModelEntry[] = [
      {
        id: "claude-code-cli-frontier",
        provider: "anthropic",
        capability: "frontier",
        roles: ["planner"],
        accessMode: "claude-code-cli",
        enabled: true,
      },
      {
        id: "codex-cli-auto",
        provider: "local",
        capability: "strong",
        roles: ["planner"],
        accessMode: "codex-cli",
        enabled: true,
      },
    ];

    const resolution = new PlannerProviderRegistry().resolve({
      registryModels: models,
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1", KIWI_FORCE_ACCESS_MODE: "codex-cli" },
    });

    expect(resolution.model.id).toBe("codex-cli-auto");
    expect(resolution.provider.name).toBe("codex-cli:default");
  });

  it("can build a Cursor Agent CLI planner provider", () => {
    const models: ModelEntry[] = [
      {
        id: "cursor-agent-auto",
        provider: "local",
        capability: "strong",
        roles: ["planner"],
        accessMode: "cursor-agent-cli",
        enabled: true,
      },
    ];

    const resolution = new PlannerProviderRegistry().resolve({
      registryModels: models,
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(resolution.model.id).toBe("cursor-agent-auto");
    expect(resolution.provider.name).toBe("cursor-agent-cli:default");
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

  it("can build Codex and Cursor reviewer providers", () => {
    const models: ModelEntry[] = [
      {
        id: "codex-cli-auto",
        provider: "local",
        capability: "strong",
        roles: ["reviewer"],
        accessMode: "codex-cli",
        enabled: true,
      },
      {
        id: "cursor-agent-auto",
        provider: "local",
        capability: "strong",
        roles: ["reviewer"],
        accessMode: "cursor-agent-cli",
        enabled: true,
      },
    ];
    const registry = new ReviewerProviderRegistry();

    expect(
      registry.select({
        registryModels: models,
        policy,
        env: { KIWI_FAKE_BINARY_AVAILABLE: "1", KIWI_FORCE_ACCESS_MODE: "codex-cli" },
      })?.provider.name,
    ).toBe("codex-cli:default");
    expect(
      registry.select({
        registryModels: models,
        policy,
        env: { KIWI_FAKE_BINARY_AVAILABLE: "1", KIWI_FORCE_ACCESS_MODE: "cursor-agent-cli" },
      })?.provider.name,
    ).toBe("cursor-agent-cli:default");
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

  it("can build Codex and Cursor researcher providers", () => {
    const models: ModelEntry[] = [
      {
        id: "codex-cli-auto",
        provider: "local",
        capability: "strong",
        roles: ["researcher"],
        accessMode: "codex-cli",
        enabled: true,
      },
      {
        id: "cursor-agent-auto",
        provider: "local",
        capability: "strong",
        roles: ["researcher"],
        accessMode: "cursor-agent-cli",
        enabled: true,
      },
    ];
    const registry = new ResearcherProviderRegistry();

    expect(
      registry.select({
        registryModels: models,
        env: { KIWI_FAKE_BINARY_AVAILABLE: "1", KIWI_FORCE_ACCESS_MODE: "codex-cli" },
      })?.provider.name,
    ).toBe("codex-cli:default");
    expect(
      registry.select({
        registryModels: models,
        env: { KIWI_FAKE_BINARY_AVAILABLE: "1", KIWI_FORCE_ACCESS_MODE: "cursor-agent-cli" },
      })?.provider.name,
    ).toBe("cursor-agent-cli:default");
  });
});
