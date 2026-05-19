import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { ModelEntry } from "@kiwi/contracts";
import {
  evaluateAccessModeAvailability,
  preferredAccessModes,
  selectEnabledModelByAccessMode,
} from "../../registries/access-mode-resolver";

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

function fakeClaudeBin(script: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiwi-claude-bin-"));
  const target = path.join(dir, "claude");
  writeFileSync(target, `#!/usr/bin/env sh\n${script}\n`, "utf-8");
  chmodSync(target, 0o755);

  return dir;
}

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
      env: { ANTHROPIC_API_KEY: "test-api-key", PATH: "/empty" },
    });
    expect(result?.model.accessMode).toBe("anthropic-api");
  });

  it("does not fall back to stub when no real provider is available by default", () => {
    const result = selectEnabledModelByAccessMode({
      candidates,
      env: { PATH: "/empty" },
    });
    expect(result).toBeNull();
  });

  it("allows stub only when explicitly enabled", () => {
    const result = selectEnabledModelByAccessMode({
      candidates,
      env: { PATH: "/empty" },
      allowStub: true,
    });
    expect(result?.model.accessMode).toBe("stub");
  });

  it("respects KIWI_FORCE_ACCESS_MODE", () => {
    const order = preferredAccessModes({ KIWI_FORCE_ACCESS_MODE: "anthropic-api" });
    expect(order).toEqual(["anthropic-api"]);
  });

  it("prioritizes Codex-first local CLIs before direct APIs", () => {
    expect(preferredAccessModes({}).slice(0, 5)).toEqual([
      "codex-cli",
      "claude-code-cli",
      "cursor-agent-cli",
      "anthropic-api",
      "openai-api",
    ]);
  });

  it("evaluates explicit access mode availability", () => {
    expect(evaluateAccessModeAvailability("stub", {}).available).toBe(true);
    expect(evaluateAccessModeAvailability("anthropic-api", {}).available).toBe(false);
    expect(evaluateAccessModeAvailability("anthropic-api", { ANTHROPIC_API_KEY: "x" }).available).toBe(true);
    expect(evaluateAccessModeAvailability("cursor-agent-cli", { PATH: "/empty" }).available).toBe(false);
  });

  it("treats Claude Code CLI as unavailable when auth status is logged out", () => {
    const binDir = fakeClaudeBin(`printf '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'; exit 1`);
    const availability = evaluateAccessModeAvailability("claude-code-cli", {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    });

    expect(availability.available).toBe(false);
    expect(availability.reason).toContain("not logged in");
  });

  it("treats Claude Code CLI as available when auth status is logged in", () => {
    const binDir = fakeClaudeBin(`printf '{"loggedIn":true,"authMethod":"oauth","apiProvider":"firstParty"}'`);
    const availability = evaluateAccessModeAvailability("claude-code-cli", {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    });

    expect(availability.available).toBe(true);
    expect(availability.reason).toContain("authenticated");
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
