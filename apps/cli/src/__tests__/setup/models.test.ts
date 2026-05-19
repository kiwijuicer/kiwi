import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { kiwiHomeModelRegistryPath, kiwiModelRegistryPath, loadRegistry } from "@kiwi/core";
import { runModelsList, runModelsUpdate } from "../../commands/setup/models.js";

const NOW = new Date("2026-05-19T12:00:00.000Z");

function testEnv(cwd: string): Record<string, string | undefined> {
  return {
    KIWI_HOME: path.join(path.dirname(cwd), `${path.basename(cwd)}-home`),
  };
}

function testCatalog(): object {
  return {
    catalogVersion: "test-2026-05-19",
    generatedAt: "2026-05-19T00:00:00.000Z",
    pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z",
    providers: [{ name: "openai", sourceUrl: "https://openai.com/api/pricing/" }],
    pricing: {
      "openai:gpt-5.4-mini": {
        currency: "USD",
        inputUsdPerMillion: 0.75,
        outputUsdPerMillion: 4.5,
        source: "openai",
        sourceUrl: "https://openai.com/api/pricing/",
        sourceVersion: "2026-05-19",
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z",
      },
      "openai:gpt-5.3": {
        currency: "USD",
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 8,
        source: "openai",
        sourceUrl: "https://openai.com/api/pricing/",
        sourceVersion: "2026-05-19",
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z",
      },
    },
    tierMapping: {
      mid: ["codex-cli-mid", "codex-cli-deprecated"],
    },
    models: [
      {
        id: "codex-cli-mid",
        providerModel: "gpt-5.4-mini",
        provider: "local",
        capability: "mid",
        roles: ["executor"],
        accessMode: "codex-cli",
        enabled: true,
        pricingRef: "openai:gpt-5.4-mini",
        deprecatedAt: null,
        replacementModelId: null,
      },
      {
        id: "codex-cli-deprecated",
        providerModel: "gpt-5.3",
        provider: "local",
        capability: "mid",
        roles: ["executor"],
        accessMode: "codex-cli",
        enabled: true,
        pricingRef: "openai:gpt-5.3",
        deprecatedAt: "2026-05-19T00:00:00.000Z",
        replacementModelId: "codex-cli-mid",
      },
    ],
  };
}

function writeCatalog(cwd: string): string {
  const catalogPath = path.join(cwd, "config", "model-catalog.json");

  mkdirSync(path.dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, JSON.stringify(testCatalog(), null, 2), "utf-8");

  return catalogPath;
}

async function runSilenced(opts: Parameters<typeof runModelsUpdate>[0], cwd: string): Promise<string> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

  try {
    await runModelsUpdate(opts, cwd);

    return spy.mock.calls.flat().join("\n");
  } finally {
    spy.mockRestore();
  }
}

describe("models update command", () => {
  it("dry-runs by default and does not write home defaults", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-models-dry-run-"));
    const env = testEnv(cwd);

    await runSilenced({ catalogPath: writeCatalog(cwd), env }, cwd);

    expect(existsSync(kiwiHomeModelRegistryPath(env))).toBe(false);
  });

  it("applies only to home defaults and preserves workspace overrides", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-models-apply-"));
    const env = testEnv(cwd);
    const workspaceRegistryPath = kiwiModelRegistryPath(cwd);
    const workspaceRegistry = "models:\n  - id: codex-cli-mid\n    enabled: false\n";

    mkdirSync(path.dirname(workspaceRegistryPath), { recursive: true });
    writeFileSync(workspaceRegistryPath, workspaceRegistry, "utf-8");

    await runSilenced({ apply: true, catalogPath: writeCatalog(cwd), env, now: NOW }, cwd);

    const registry = loadRegistry(kiwiHomeModelRegistryPath(env));
    const deprecated = registry.models.find((model) => model.id === "codex-cli-deprecated");
    const audit = readFileSync(path.join(env.KIWI_HOME ?? "", "logs", "audit.log"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { eventType: string; payload: Record<string, unknown> });

    expect(registry.catalogVersion).toBe("test-2026-05-19");
    expect(deprecated).toMatchObject({
      enabled: false,
      deprecatedAt: "2026-05-19T00:00:00.000Z",
      replacementModelId: "codex-cli-mid",
    });
    expect(readFileSync(workspaceRegistryPath, "utf-8")).toBe(workspaceRegistry);
    expect(audit.at(-1)).toMatchObject({
      eventType: "model_registry_refreshed",
      payload: {
        catalogVersion: "test-2026-05-19",
        addedModelIds: ["codex-cli-deprecated", "codex-cli-mid"],
      },
    });
  });

  it("prints machine-readable dry-run diffs", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-models-json-"));
    const output = await runSilenced({ catalogPath: writeCatalog(cwd), env: testEnv(cwd), json: true }, cwd);
    const result = JSON.parse(output) as { applied: boolean; diff: { addedModelIds: string[] } };

    expect(result.applied).toBe(false);
    expect(result.diff.addedModelIds).toEqual(["codex-cli-deprecated", "codex-cli-mid"]);
  });

  it("lists effective models as JSON", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-models-list-"));
    const env = testEnv(cwd);

    await runSilenced({ apply: true, catalogPath: writeCatalog(cwd), env, now: NOW }, cwd);

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    let output = "";

    try {
      await runModelsList({ env, json: true }, cwd);
      output = spy.mock.calls.flat().join("\n");
    } finally {
      spy.mockRestore();
    }
    const parsed = JSON.parse(output) as { models: Array<{ id: string; capability: string; pricing: object }> };

    expect(parsed.models.some((model) => model.id === "codex-cli-mid" && model.capability === "mid")).toBe(true);
    expect(parsed.models[0]?.pricing).toBeDefined();
  });
});
