import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Initiative, TaskGraph } from "@kiwi/contracts";
import { appendAuditEvent, readAuditEvents, savePlannedRun } from "@kiwi/core";
import { runScheduledSubPlans } from "../../execution/parallel-scheduler.js";

function fixtureInitiative(runId: string): Initiative {
  return {
    id: `init_${runId.replace(/^run_/, "")}`,
    title: "Parallel scheduler fixture",
    rawInput: "# Parallel scheduler fixture",
    source: "cli",
    repoPath: "/tmp/repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-06T12:00:00.000Z",
  };
}

function fixtureTaskGraph(runId: string, initiativeId: string): TaskGraph {
  return {
    planId: `plan_${runId.replace(/^run_/, "")}`,
    runId,
    initiativeId,
    summary: "Parallel scheduler graph",
    steps: [
      {
        stepId: "step_001",
        type: "planning",
        title: "Chain A step 1",
        dependsOn: [],
        successCriteria: ["done"],
        requiredGates: [],
        recommendedAgentRole: "planner",
        recommendedModelCapability: "frontier",
        status: "pending",
      },
      {
        stepId: "step_002",
        type: "planning",
        title: "Chain A step 2",
        dependsOn: ["step_001"],
        successCriteria: ["done"],
        requiredGates: [],
        recommendedAgentRole: "planner",
        recommendedModelCapability: "frontier",
        status: "pending",
      },
      {
        stepId: "step_003",
        type: "planning",
        title: "Chain B step 1",
        dependsOn: [],
        successCriteria: ["done"],
        requiredGates: [],
        recommendedAgentRole: "planner",
        recommendedModelCapability: "frontier",
        status: "pending",
      },
      {
        stepId: "step_004",
        type: "planning",
        title: "Chain B step 2",
        dependsOn: ["step_003"],
        successCriteria: ["done"],
        requiredGates: [],
        recommendedAgentRole: "planner",
        recommendedModelCapability: "frontier",
        status: "pending",
      },
    ],
    subPlans: [
      {
        subPlanId: "subplan_1",
        title: "Chain A",
        stepIds: ["step_001", "step_002"],
        dependsOn: [],
        maxConcurrency: 1,
      },
      {
        subPlanId: "subplan_2",
        title: "Chain B",
        stepIds: ["step_003", "step_004"],
        dependsOn: [],
        maxConcurrency: 1,
      },
    ],
    acceptanceCriteria: ["all steps completed"],
    assumptions: [],
    openQuestions: [],
    riskScore: 2,
    complexityScore: 3,
    createdAt: "2026-05-06T12:00:00.000Z",
  };
}

describe("parallel scheduler", () => {
  it("starts independent subplans in parallel with interleaved start timestamps", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-parallel-scheduler-"));
    const runId = "run_20260506_120000_parallel";
    const initiative = fixtureInitiative(runId);
    savePlannedRun({
      cwd,
      runId,
      initiative,
      taskGraph: fixtureTaskGraph(runId, initiative.id),
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    await runScheduledSubPlans({
      cwd,
      runId,
      maxGlobalConcurrency: 2,
      runStep: async (_scheduledRunId, stepId, options) => {
        appendAuditEvent(cwd, {
          eventType: "step_attempt_started",
          runId,
          timestamp: new Date().toISOString(),
          payload: {
            stepId,
            attemptId: options.attemptId,
            runner: "test-runner",
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
      },
    });

    const started = readAuditEvents(cwd, runId).filter((event) => event.eventType === "step_attempt_started");
    expect(started).toHaveLength(4);
    expect(
      started
        .slice(0, 2)
        .map((event) => event.payload.stepId)
        .sort(),
    ).toEqual(["step_001", "step_003"]);

    const firstTs = Date.parse(started[0]!.timestamp);
    const secondTs = Date.parse(started[1]!.timestamp);
    expect(Math.abs(firstTs - secondTs)).toBeLessThan(150);
  });
});
