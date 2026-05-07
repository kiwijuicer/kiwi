import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { runExplain } from "../commands/explain";
import { runInit } from "../commands/init";
import { runPlan } from "../commands/plan";

describe("kiwi explain", () => {
  it("prints subplan tree output", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-explain-"));
    await runInit({}, cwd);
    await runPlan(
      "# Feature: Explain Tree\n\n## Analyze\n## Implement\n## Validate",
      {
        allowStub: true,
        env: { PATH: "/empty" },
        now: new Date("2026-05-06T10:00:00.000Z"),
        runIdSuffix: "x001",
        initiativeIdSuffix: "x001",
        planIdSuffix: "x001",
      },
      cwd,
    );

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runExplain("run_20260506_100000_x001", {}, cwd);
    const output = spy.mock.calls.flat().join("\n");
    spy.mockRestore();

    expect(output).toContain("subplans:");
    expect(output).toContain("subplan_1 [max=1]");
    expect(output).toContain("step_001 Analyze");
  });
});
