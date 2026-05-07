import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { runInit } from "../commands/init";
import { runPlan } from "../commands/plan";
import { runStatus } from "../commands/status";

describe("kiwi status", () => {
  it("prints explicit empty-state summary", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-status-"));
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runStatus(cwd);

    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("runs: 0");
    expect(output).toContain("no runs found");
    spy.mockRestore();
  });

  it("prints detailed run summary with title, plan, step count, and artifact paths", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-status-details-"));
    await runInit({}, cwd);
    await runPlan(
      "# Feature: Status Details\n\n## Analyze\n## Plan\n## Implement\n## Validate",
      {
        allowStub: true,
        env: { PATH: "/empty" },
        now: new Date("2026-05-04T04:00:00.000Z"),
        runIdSuffix: "s001",
        initiativeIdSuffix: "s001",
        planIdSuffix: "s001",
      },
      cwd,
    );

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runStatus(cwd);
    const output = spy.mock.calls.flat().join("\n");

    expect(output).toContain("runs: 1");
    expect(output).toContain("run_20260504_060000_s001");
    expect(output).toContain("title: Feature: Status Details");
    expect(output).toContain("plan: plan_20260504_060000_s001");
    expect(output).toContain("steps: 4");
    expect(output).toContain("subplans:");
    expect(output).toContain("subplan_1 [max=1]");
    expect(output).toContain(".kiwi/runs/run_20260504_060000_s001/run.json");
    expect(output).toContain(".kiwi/runs/run_20260504_060000_s001/initiative.json");
    expect(output).toContain(".kiwi/runs/run_20260504_060000_s001/plan/task-graph.json");
    spy.mockRestore();
  });

  it("supports selected run view", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-status-select-"));
    await runInit({}, cwd);
    await runPlan(
      "Ticket A",
      {
        allowStub: true,
        env: { PATH: "/empty" },
        now: new Date("2026-05-04T04:00:00.000Z"),
        runIdSuffix: "a001",
        initiativeIdSuffix: "a001",
        planIdSuffix: "a001",
      },
      cwd,
    );
    await runPlan(
      "Ticket B",
      {
        allowStub: true,
        env: { PATH: "/empty" },
        now: new Date("2026-05-04T04:00:01.000Z"),
        runIdSuffix: "b002",
        initiativeIdSuffix: "b002",
        planIdSuffix: "b002",
      },
      cwd,
    );

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runStatus(cwd, "run_20260504_060001_b002");
    const output = spy.mock.calls.flat().join("\n");

    expect(output).toContain("selected_run: run_20260504_060001_b002");
    expect(output).toContain("runs: 1");
    expect(output).toContain("run_20260504_060001_b002");
    expect(output).not.toContain("run_20260504_060000_a001");
    spy.mockRestore();
  });

  it("fails explicitly on corrupt or partial run folders", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-status-corrupt-"));
    mkdirSync(path.join(cwd, ".kiwi", "runs", "run_20260504_040000_broken", "plan"), {
      recursive: true,
    });
    writeFileSync(
      path.join(cwd, ".kiwi", "runs", "run_20260504_040000_broken", "run.json"),
      JSON.stringify({
        runId: "run_20260504_040000_broken",
        initiativeId: "init_20260504_040000_broken",
        currentPlanId: "plan_20260504_040000_broken",
        status: "planned",
        createdAt: "2026-05-04T04:00:00.000Z",
        updatedAt: "2026-05-04T04:00:00.000Z",
      }),
      "utf-8",
    );

    await expect(runStatus(cwd)).rejects.toThrow("is corrupt");
  });
});
