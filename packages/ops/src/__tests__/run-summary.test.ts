import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Initiative, TaskGraph } from "@kiwi/contracts";
import { appendModelInvocation, savePlannedRun } from "@kiwi/core";
import { buildRunCompletionSummary } from "../run-summary";

const NOW = "2026-05-04T13:00:00.000Z";

function createRun(cwd: string): void {
  const initiative: Initiative = {
    id: "init_demo",
    title: "Run Summary Demo",
    rawInput: "# Demo",
    source: "cli",
    repoPath: cwd,
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: NOW,
  };
  const taskGraph: TaskGraph = {
    planId: "plan_demo",
    runId: "run_demo",
    initiativeId: "init_demo",
    summary: "Demo graph",
    steps: [
      {
        stepId: "step_001",
        type: "coding",
        title: "Step one",
        dependsOn: [],
        successCriteria: ["done"],
        requiredGates: [],
        recommendedAgentRole: "executor",
        recommendedModelCapability: "strong",
        status: "pending",
      },
      {
        stepId: "step_002",
        type: "coding",
        title: "Step two",
        dependsOn: ["step_001"],
        successCriteria: ["done"],
        requiredGates: [],
        recommendedAgentRole: "executor",
        recommendedModelCapability: "strong",
        status: "pending",
      },
    ],
    acceptanceCriteria: ["done"],
    assumptions: [],
    openQuestions: [],
    riskScore: 2,
    complexityScore: 2,
    createdAt: NOW,
  };
  savePlannedRun({
    cwd,
    runId: "run_demo",
    initiative,
    taskGraph,
    now: new Date(NOW),
  });
}

describe("run summary cost rollups", () => {
  it("aggregates by-step and by-model costs and emits unknown-precision warning", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-ops-summary-"));
    createRun(cwd);
    appendModelInvocation(cwd, {
      schemaVersion: "1",
      runId: "run_demo",
      phase: "executor",
      stepId: "step_001",
      attemptId: "attempt_001",
      agentRole: "executor",
      requestedCapability: "strong",
      selectedCapability: "strong",
      modelId: "model-a",
      providerName: "stub",
      runner: "local-shell",
      usage: { inputTokens: 10, outputTokens: 2 },
      usagePrecision: "estimated",
      estimatedCostUsd: 0.05,
      status: "completed",
      evidenceRefs: [],
      startedAt: NOW,
      completedAt: NOW,
    });
    appendModelInvocation(cwd, {
      schemaVersion: "1",
      runId: "run_demo",
      phase: "reviewer",
      stepId: "step_001",
      attemptId: "attempt_001",
      agentRole: "reviewer",
      requestedCapability: "strong",
      selectedCapability: "strong",
      modelId: "model-r",
      providerName: "stub",
      runner: null,
      usage: { inputTokens: 6, outputTokens: 1 },
      usagePrecision: "unknown",
      estimatedCostUsd: 0.02,
      status: "completed",
      evidenceRefs: [],
      startedAt: NOW,
      completedAt: NOW,
    });
    appendModelInvocation(cwd, {
      schemaVersion: "1",
      runId: "run_demo",
      phase: "executor",
      stepId: "step_002",
      attemptId: "attempt_002",
      agentRole: "executor",
      requestedCapability: "strong",
      selectedCapability: "strong",
      modelId: "model-b",
      providerName: "stub",
      runner: "local-shell",
      usage: { inputTokens: 12, outputTokens: 3 },
      usagePrecision: "estimated",
      estimatedCostUsd: 0.07,
      status: "completed",
      evidenceRefs: [],
      startedAt: NOW,
      completedAt: NOW,
    });

    const summary = buildRunCompletionSummary({ cwd, runId: "run_demo" });
    expect(summary.byStepCostsUsd.step_001).toEqual({
      planner: 0,
      executor: 0.05,
      reviewer: 0.02,
    });
    expect(summary.byStepCostsUsd.step_002).toEqual({
      planner: 0,
      executor: 0.07,
      reviewer: 0,
    });
    expect(Object.keys(summary.byModelCostsUsd).length).toBeGreaterThan(0);
    expect(summary.warnings).toContain(
      "cost_precision_unknown_dominant: most invocations have unknown token precision; verify provider usage metadata.",
    );
  });
});
