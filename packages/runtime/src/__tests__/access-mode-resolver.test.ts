import { describe, expect, it } from "vitest";
import { ModelEntry } from "@kiwi/contracts";
import {
  evaluateAccessModeAvailability,
  preferredAccessModes,
  selectEnabledModelByAccessMode,
} from "../access-mode-resolver";

const candidates: ModelEntry[] = [
  {
    id: "claude-code-cli-opus-4-6",
    provider: "anthropic",
    capability: "frontier",
    roles: ["planner", "reviewer"],
    accessMode: "claude-code-cli",
    enabled: true,
  },
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    capability: "frontier",
    roles: ["planner", "reviewer"],
    accessMode: "anthropic-api",
    enabled: true,
  },
  {
    id: "stub-frontier",
    provider: "stub",
    capability: "frontier",
    roles: ["planner", "reviewer"],
    accessMode: "stub",
    enabled: true,
  },
];

describe("access mode resolver", () => {
  it("prefers Claude Code CLI when binary is available", () => {
    const result = selectEnabledModelByAccessMode({
      candidates,
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });
    expect(result?.model.accessMode).toBe("claude-code-cli");
  });

  it("falls back to anthropic-api when CLI binary is missing but key is set", () => {
    const result = selectEnabledModelByAccessMode({
      candidates,
      env: { ANTHROPIC_API_KEY: "sk-ant-test", PATH: "/empty" },
    });
    expect(result?.model.accessMode).toBe("anthropic-api");
  });

  it("falls back to stub when no real provider is available", () => {
    const result = selectEnabledModelByAccessMode({
      candidates,
      env: { PATH: "/empty" },
    });
    expect(result?.model.accessMode).toBe("stub");
  });

  it("respects KIWI_FORCE_ACCESS_MODE", () => {
    const order = preferredAccessModes({ KIWI_FORCE_ACCESS_MODE: "anthropic-api" });
    expect(order).toEqual(["anthropic-api"]);
  });

  it("prioritizes local CLIs including cursor-agent before direct APIs", () => {
    expect(preferredAccessModes({}).slice(0, 5)).toEqual([
      "claude-code-cli",
      "codex-cli",
      "cursor-agent-cli",
      "anthropic-api",
      "openai-api",
    ]);
  });

  it("evaluates explicit access mode availability", () => {
    expect(evaluateAccessModeAvailability("stub", {}).available).toBe(true);
    expect(evaluateAccessModeAvailability("anthropic-api", {}).available).toBe(false);
    expect(
      evaluateAccessModeAvailability("anthropic-api", { ANTHROPIC_API_KEY: "x" }).available,
    ).toBe(true);
    expect(evaluateAccessModeAvailability("cursor-agent-cli", { PATH: "/empty" }).available).toBe(false);
  });

  it("excludes stub when excludeStub flag is set", () => {
    const result = selectEnabledModelByAccessMode({
      candidates,
      env: { PATH: "/empty" },
      excludeStub: true,
    });
    expect(result).toBeNull();
  });
});
