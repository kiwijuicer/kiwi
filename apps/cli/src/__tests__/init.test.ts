import { existsSync, mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { runInit } from "../commands/init";

describe("kiwi init", () => {
  it("creates .kiwi and default config files", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-"));

    await runInit({}, cwd);

    expect(existsSync(path.join(cwd, ".kiwi", "config.yaml"))).toBe(true);
    expect(existsSync(path.join(cwd, ".kiwi", "runs"))).toBe(true);
    expect(existsSync(path.join(cwd, "kiwi-policy.yaml"))).toBe(true);
    expect(existsSync(path.join(cwd, "model-registry.yaml"))).toBe(true);
  });
});
