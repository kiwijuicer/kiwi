import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { ReviewVerdictSchema, Step, TaskGraphSchema } from "@kiwi/contracts";
import { loadTaskGraph, readAuditEvents } from "@kiwi/core";
import { attemptReplan, injectFixStep } from "../replanner";

const NOW = new Date("2026-05-06T10:00:00.000Z");

function tmpCwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-replanner-"));
}

function fixtureStep(overrides: Partial<Step> = {}): Step {
  return {
    stepId: "step_001",
    type: "coding",
    title: "Implement feature",
    dependsOn: [],
    successCriteria: ["Feature implemented"],
    requiredGates: [],
    recommendedAgentRole: "executor",
    recommendedModelCapability: "strong",
    status: "pending",
    ...overrides,
  };
}

function writeTaskGraph(cwd: string, runId: string, steps: Step[]): void {
  const planDir = path.join(cwd, ".kiwi", "runs", runId, "plan");
  mkdirSync(planDir, { recursive: true });
  const graph = TaskGraphSchema.parse({
    planId: "plan_20260506_100000_aa",
    runId,
    initiativeId: "init_20260506_100000_bb",
    summary: "Test plan",
    steps,
    acceptanceCriteria: ["All steps done"],
    assumptions: [],
    openQuestions: [],
    riskScore: 2,
    complexityScore: 2,
    createdAt: NOW.toISOString(),
  });
  writeFileSync(path.join(planDir, "task-graph.json"), JSON.stringify(graph), "utf-8");
}

function loadTaskGraphRaw(cwd: string, runId: string, filename = "task-graph.json"): ReturnType<typeof TaskGraphSchema.parse> {
  const raw = readFileSync(path.join(cwd, ".kiwi", "runs", runId, "plan", filename), "utf-8");
  return TaskGraphSchema.parse(JSON.parse(raw));
}

function needsChangesVerdict() {
  return ReviewVerdictSchema.parse({
    verdict: "needs_changes",
    safeToContinue: false,
    issues: [{ code: "LINT_FAIL", title: "Lint errors found", severity: "medium", detail: "Two lint errors" }],
    recommendedNextSteps: ["Fix lint errors in src/index.ts"],
    confidence: 0.9,
  });
}

function rejectVerdict() {
  return ReviewVerdictSchema.parse({
    verdict: "reject",
    safeToContinue: false,
    issues: [{ code: "SECURITY_VIOLATION", title: "Forbidden path access", severity: "high", detail: "Access to /etc" }],
    recommendedNextSteps: ["Remove forbidden path access", "Add policy guard"],
    confidence: 0.95,
  });
}

// ─── injectFixStep ───────────────────────────────────────────────────────────

describe("injectFixStep", () => {
  it("inserts a code_modification step immediately after the focal step", () => {
    const cwd = tmpCwd();
    const runId = "run_20260506_inject_01";
    const steps = [
      fixtureStep({ stepId: "step_001" }),
      fixtureStep({ stepId: "step_002", title: "Run tests", dependsOn: ["step_001"] }),
    ];
    writeTaskGraph(cwd, runId, steps);

    const result = injectFixStep({
      cwd,
      runId,
      focalStepId: "step_001",
      reviewVerdict: needsChangesVerdict(),
      now: NOW,
    });

    const updated = loadTaskGraphRaw(cwd, runId);
    expect(updated.steps).toHaveLength(3);
    expect(updated.steps[1]!.stepId).toBe(result.injectedStepId);
    expect(updated.steps[1]!.type).toBe("code_modification");
    expect(updated.steps[1]!.dependsOn).toEqual(["step_001"]);
    expect(updated.steps[1]!.successCriteria).toEqual(["Fix lint errors in src/index.ts"]);
    // original step_002 stays at index 2
    expect(updated.steps[2]!.stepId).toBe("step_002");
  });

  it("falls back to default successCriteria when verdict has no recommendedNextSteps", () => {
    const cwd = tmpCwd();
    const runId = "run_20260506_inject_02";
    writeTaskGraph(cwd, runId, [fixtureStep()]);

    const verdict = ReviewVerdictSchema.parse({
      verdict: "needs_changes",
      safeToContinue: false,
      issues: [{ code: "X", title: "Issue", severity: "medium", detail: "No detail" }],
      recommendedNextSteps: [],
      confidence: 0.8,
    });

    injectFixStep({ cwd, runId, focalStepId: "step_001", reviewVerdict: verdict, now: NOW });

    const updated = loadTaskGraphRaw(cwd, runId);
    expect(updated.steps[1]!.successCriteria).toEqual(["Fix issues identified in review"]);
  });

  it("generates a non-conflicting step ID when focal step is not step_001", () => {
    const cwd = tmpCwd();
    const runId = "run_20260506_inject_03";
    const steps = [
      fixtureStep({ stepId: "step_001" }),
      fixtureStep({ stepId: "step_002", dependsOn: ["step_001"] }),
      fixtureStep({ stepId: "step_003", dependsOn: ["step_002"] }),
    ];
    writeTaskGraph(cwd, runId, steps);

    const result = injectFixStep({
      cwd,
      runId,
      focalStepId: "step_002",
      reviewVerdict: needsChangesVerdict(),
      now: NOW,
    });

    expect(result.injectedStepId).toBe("step_004");
    const updated = loadTaskGraphRaw(cwd, runId);
    expect(updated.steps).toHaveLength(4);
    expect(updated.steps[2]!.stepId).toBe("step_004");
    expect(updated.steps[3]!.stepId).toBe("step_003");
  });

  it("emits a fix_step_injected audit event", () => {
    const cwd = tmpCwd();
    const runId = "run_20260506_inject_04";
    writeTaskGraph(cwd, runId, [fixtureStep()]);
    mkdirSync(path.join(cwd, ".kiwi", "logs"), { recursive: true });

    injectFixStep({ cwd, runId, focalStepId: "step_001", reviewVerdict: needsChangesVerdict(), now: NOW });

    const events = readAuditEvents(cwd, runId);
    const injected = events.find((e) => e.eventType === "fix_step_injected");
    expect(injected).toBeDefined();
    expect(injected!.payload.focalStepId).toBe("step_001");
    expect(injected!.payload.verdict).toBe("needs_changes");
  });
});

// ─── attemptReplan ───────────────────────────────────────────────────────────

describe("attemptReplan", () => {
  it("writes task-graph.v2.json next to the original", () => {
    const cwd = tmpCwd();
    const runId = "run_20260506_replan_01";
    writeTaskGraph(cwd, runId, [fixtureStep()]);

    const result = attemptReplan({
      cwd,
      runId,
      focalStepId: "step_001",
      reviewVerdict: rejectVerdict(),
      now: NOW,
    });

    expect(result.version).toBe(2);
    expect(result.taskGraphPath).toBe("plan/task-graph.v2.json");
    const v2Path = path.join(cwd, ".kiwi", "runs", runId, "plan", "task-graph.v2.json");
    expect(existsSync(v2Path)).toBe(true);
  });

  it("increments version when a v2 already exists", () => {
    const cwd = tmpCwd();
    const runId = "run_20260506_replan_02";
    writeTaskGraph(cwd, runId, [fixtureStep()]);
    // Simulate an existing v2
    mkdirSync(path.join(cwd, ".kiwi", "runs", runId, "plan"), { recursive: true });
    const planDir = path.join(cwd, ".kiwi", "runs", runId, "plan");
    const v2Content = readFileSync(path.join(planDir, "task-graph.json"), "utf-8");
    writeFileSync(path.join(planDir, "task-graph.v2.json"), v2Content);

    const result = attemptReplan({
      cwd,
      runId,
      focalStepId: "step_001",
      reviewVerdict: rejectVerdict(),
      now: NOW,
    });

    expect(result.version).toBe(3);
    expect(existsSync(path.join(planDir, "task-graph.v3.json"))).toBe(true);
  });

  it("embeds verdict context in the versioned plan summary and openQuestions", () => {
    const cwd = tmpCwd();
    const runId = "run_20260506_replan_03";
    writeTaskGraph(cwd, runId, [fixtureStep()]);

    attemptReplan({ cwd, runId, focalStepId: "step_001", reviewVerdict: rejectVerdict(), now: NOW });

    const v2 = loadTaskGraphRaw(cwd, runId, "task-graph.v2.json");
    expect(v2.summary).toContain("Replanned v2");
    expect(v2.summary).toContain("step_001");
    expect(v2.openQuestions).toContain("Remove forbidden path access");
    expect(v2.openQuestions).toContain("Add policy guard");
  });

  it("emits a replan_succeeded audit event", () => {
    const cwd = tmpCwd();
    const runId = "run_20260506_replan_04";
    writeTaskGraph(cwd, runId, [fixtureStep()]);
    mkdirSync(path.join(cwd, ".kiwi", "logs"), { recursive: true });

    attemptReplan({ cwd, runId, focalStepId: "step_001", reviewVerdict: rejectVerdict(), now: NOW });

    const events = readAuditEvents(cwd, runId);
    const event = events.find((e) => e.eventType === "replan_succeeded");
    expect(event).toBeDefined();
    expect(event!.payload.version).toBe(2);
    expect(event!.payload.focalStepId).toBe("step_001");
    expect(event!.payload.verdict).toBe("reject");
  });

  it("loadTaskGraph prefers task-graph.v2.json over task-graph.json", () => {
    const cwd = tmpCwd();
    const runId = "run_20260506_replan_05";
    writeTaskGraph(cwd, runId, [fixtureStep()]);

    attemptReplan({ cwd, runId, focalStepId: "step_001", reviewVerdict: rejectVerdict(), now: NOW });

    // loadTaskGraph should now return the v2 graph (with updated summary)
    const loaded = loadTaskGraph(runId, cwd);
    expect(loaded.summary).toContain("Replanned v2");
  });
});
