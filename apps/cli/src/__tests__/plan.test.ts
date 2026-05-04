import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  InitiativeSchema,
  RunManifestSchema,
  TaskGraphSchema,
} from "@ai-kiwi/contracts";
import { runInit } from "../commands/init";
import { runPlan } from "../commands/plan";

function readJson(target: string): unknown {
  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}

describe("kiwi plan", () => {
  it("stores schema-valid planned run artifacts under run directory", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-plan-"));
    await runInit({}, cwd);

    const ticketPath = path.join(cwd, "ticket.md");
    writeFileSync(
      ticketPath,
      `# Feature: Roles

## Analyze current behavior
## Plan implementation
## Add tests
## Implement changes
## Validate`,
      "utf-8",
    );

    await runPlan(
      ticketPath,
      {
        now: new Date("2026-05-03T19:00:00.000Z"),
        runIdSuffix: "abcd",
        initiativeIdSuffix: "abcd",
        planIdSuffix: "abcd",
      },
      cwd,
    );

    const runsRoot = path.join(cwd, ".kiwi", "runs");
    const runs = readdirSync(runsRoot);
    expect(runs.length).toBe(1);

    const runId = runs[0];
    expect(runId).toBeDefined();
    const runDir = path.join(runsRoot, runId!);
    const run = RunManifestSchema.parse(readJson(path.join(runDir, "run.json")));
    const initiative = InitiativeSchema.parse(readJson(path.join(runDir, "initiative.json")));
    const taskGraph = TaskGraphSchema.parse(
      readJson(path.join(runDir, "plan", "task-graph.json")),
    );

    expect(run.runId).toBe("run_20260503_190000_abcd");
    expect(initiative.id).toBe("init_20260503_190000_abcd");
    expect(taskGraph.planId).toBe("plan_20260503_190000_abcd");
    expect(existsSync(path.join(runDir, "plan", "planner-input.json"))).toBe(false);
    expect(existsSync(path.join(runDir, "plan", "planner-output.json"))).toBe(false);
  });

  it("accepts inline ticket text when the argument is not a file path", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-plan-inline-"));
    await runInit({}, cwd);

    await runPlan("Implement inline ticket planning", {}, cwd);

    const runsRoot = path.join(cwd, ".kiwi", "runs");
    const runs = readdirSync(runsRoot);
    expect(runs).toHaveLength(1);
    const initiative = InitiativeSchema.parse(
      readJson(path.join(runsRoot, runs[0]!, "initiative.json")),
    );

    expect(initiative.source).toBe("cli");
    expect(initiative.rawInput).toBe("Implement inline ticket planning");
  });
});
