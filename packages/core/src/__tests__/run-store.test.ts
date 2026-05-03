import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Initiative, TaskGraph } from "@ai-kiwi/contracts";
import { isInitialized, listRunManifests, loadTaskGraph, savePlannedRun } from "../run-store";

function fixtureInitiative(): Initiative {
  return {
    id: "init_demo",
    title: "Demo",
    rawInput: "# Demo",
    source: "file",
    repoPath: "/tmp/repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-03T19:00:00.000Z",
  };
}

function fixtureTaskGraph(): TaskGraph {
  return {
    planId: "plan_demo",
    runId: "run_demo",
    initiativeId: "init_demo",
    summary: "Demo graph",
    acceptanceCriteria: ["works"],
    assumptions: [],
    openQuestions: [],
    riskScore: 2,
    complexityScore: 2,
    createdAt: "2026-05-03T19:00:00.000Z",
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

describe("run store", () => {
  it("persists planned runs under .kiwi/runs/<run-id>/", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-run-store-"));
    mkdirSync(path.join(cwd, ".kiwi"), { recursive: true });
    writeFileSync(path.join(cwd, ".kiwi", "config.yaml"), "version: \"1\"\n");

    expect(isInitialized(cwd)).toBe(true);

    const manifest = savePlannedRun({
      runId: "run_demo",
      initiative: fixtureInitiative(),
      taskGraph: fixtureTaskGraph(),
      cwd,
    });

    expect(manifest.runId).toBe("run_demo");

    const listed = listRunManifests(cwd);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.currentPlanId).toBe("plan_demo");

    const loadedPlan = loadTaskGraph("run_demo", cwd);
    expect(loadedPlan.steps[0]?.title).toBe("Plan");
  });

  it("persists planner input and output artifacts when provided", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-run-store-artifacts-"));
    const taskGraph = fixtureTaskGraph();

    savePlannedRun({
      runId: "run_demo",
      initiative: fixtureInitiative(),
      taskGraph,
      plannerInput: { runId: "run_demo" },
      plannerOutput: { taskGraph, attempts: 1 },
      cwd,
      now: new Date("2026-05-03T19:00:00.000Z"),
    });

    expect(existsSync(path.join(cwd, ".kiwi", "runs", "run_demo", "plan", "planner-input.json"))).toBe(
      true,
    );
    expect(existsSync(path.join(cwd, ".kiwi", "runs", "run_demo", "plan", "planner-output.json"))).toBe(
      true,
    );
  });
});
