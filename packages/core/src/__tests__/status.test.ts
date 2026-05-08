import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Initiative, TaskGraph } from "@kiwi/contracts";
import { getRunStatusSummary } from "../status";
import { savePlannedRun } from "../run-store";
import { refreshRunStatusFromAttempts } from "../lifecycle/status";

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
  it("refreshes run status from the latest attempt for each step", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-status-retry-"));
    const runId = "run_20260504_040000_retry";

    savePlannedRun({
      runId,
      initiative: fixtureInitiative("init_20260504_040000_retry", "Feature Retry"),
      taskGraph: fixtureTaskGraph(runId, "init_20260504_040000_retry", "plan_20260504_040000_retry"),
      cwd,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });

    const attemptsDir = path.join(cwd, ".kiwi", "runs", runId, "steps", "step_001");
    for (const [attemptId, status, startedAt] of [
      ["attempt_failed", "failed", "2026-05-04T04:01:00.000Z"],
      ["attempt_completed", "completed", "2026-05-04T04:02:00.000Z"],
    ] as const) {
      const attemptDir = path.join(attemptsDir, attemptId);
      mkdirSync(attemptDir, { recursive: true });
      writeFileSync(
        path.join(attemptDir, "attempt.json"),
        JSON.stringify({
          attemptId,
          stepId: "step_001",
          runner: "local-shell",
          agentRole: "executor",
          modelCapability: "mid",
          status,
          contextPackageRef: `steps/step_001/${attemptId}/context-package.json`,
          modelInvocationRefs: [],
          artifacts: [],
          startedAt,
          completedAt: startedAt,
        }),
        "utf-8",
      );
    }

    const run = refreshRunStatusFromAttempts({
      cwd,
      runId,
      now: new Date("2026-05-04T04:03:00.000Z"),
    });

    expect(run.status).toBe("completed");
  });

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
