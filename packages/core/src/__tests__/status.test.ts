import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Initiative, TaskGraph } from "@kiwi/contracts";
import { getRunStatusSummary } from "../status";
import { savePlannedRun } from "../run-store";

function fixtureInitiative(id: string, title: string): Initiative {
  return {
    id,
    title,
    rawInput: `# ${title}`,
    source: "file",
    repoPath: "/tmp/repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-04T04:00:00.000Z",
  };
}

function fixtureTaskGraph(runId: string, initiativeId: string, planId: string): TaskGraph {
  return {
    planId,
    runId,
    initiativeId,
    summary: "Demo graph",
    acceptanceCriteria: ["works"],
    assumptions: [],
    openQuestions: [],
    riskScore: 2,
    complexityScore: 2,
    createdAt: "2026-05-04T04:00:00.000Z",
    steps: [
      {
        stepId: "step_001",
        type: "planning",
        title: "Plan",
        dependsOn: [],
        successCriteria: ["clear steps"],
        requiredGates: [],
        recommendedAgentRole: "planner",
        recommendedModelCapability: "frontier",
        status: "pending",
      },
    ],
  };
}

describe("run status summary", () => {
  it("returns detailed latest run entries", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-status-"));

    savePlannedRun({
      runId: "run_20260504_040000_a001",
      initiative: fixtureInitiative("init_20260504_040000_a001", "Feature A"),
      taskGraph: fixtureTaskGraph("run_20260504_040000_a001", "init_20260504_040000_a001", "plan_20260504_040000_a001"),
      cwd,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });

    const summary = getRunStatusSummary(cwd);
    expect(summary.total).toBe(1);
    expect(summary.latest[0]?.initiativeTitle).toBe("Feature A");
    expect(summary.latest[0]?.stepCount).toBe(1);
    expect(summary.latest[0]?.artifactPaths.taskGraph).toBe(".kiwi/runs/run_20260504_040000_a001/plan/task-graph.json");
  });

  it("supports selected run status", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-status-select-"));

    savePlannedRun({
      runId: "run_20260504_040000_a001",
      initiative: fixtureInitiative("init_20260504_040000_a001", "Feature A"),
      taskGraph: fixtureTaskGraph("run_20260504_040000_a001", "init_20260504_040000_a001", "plan_20260504_040000_a001"),
      cwd,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });
    savePlannedRun({
      runId: "run_20260504_040000_b002",
      initiative: fixtureInitiative("init_20260504_040000_b002", "Feature B"),
      taskGraph: fixtureTaskGraph("run_20260504_040000_b002", "init_20260504_040000_b002", "plan_20260504_040000_b002"),
      cwd,
      now: new Date("2026-05-04T04:00:01.000Z"),
    });

    const summary = getRunStatusSummary(cwd, "run_20260504_040000_a001");
    expect(summary.total).toBe(1);
    expect(summary.latest[0]?.runId).toBe("run_20260504_040000_a001");
  });

  it("fails explicitly for corrupt or partial run folders", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-status-corrupt-"));
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

    expect(() => getRunStatusSummary(cwd)).toThrow("is corrupt");

    rmSync(path.join(cwd, ".kiwi"), { recursive: true, force: true });
  });
});
