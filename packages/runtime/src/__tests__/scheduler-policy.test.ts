import { existsSync, mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Initiative, Step } from "@kiwi/contracts";
import { readAuditEvents } from "@kiwi/core";
import { loadContextPackage, loadSchedulerDecision, scheduleStepAttempt } from "../scheduler-policy";

function fixtureStep(overrides: Partial<Step> = {}): Step {
  return {
    stepId: "step_001",
    type: "coding",
    title: "Implement feature",
    dependsOn: [],
    successCriteria: ["Feature implemented"],
    requiredGates: ["typecheck", "lint", "tests"],
    recommendedAgentRole: "executor",
    recommendedModelCapability: "strong",
    status: "pending",
    ...overrides,
  };
}

function fixtureInitiative(overrides: Partial<Initiative> = {}): Initiative {
  return {
    id: "init_demo",
    title: "Demo Initiative",
    rawInput: "# Demo",
    source: "cli",
    repoPath: "/tmp/repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-04T06:00:00.000Z",
    ...overrides,
  };
}

describe("scheduler policy", () => {
  it("schedules low-risk step with budget-constrained capability and persisted context package", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-scheduler-low-risk-"));
    const decision = scheduleStepAttempt({
      cwd,
      runId: "run_demo",
      step: fixtureStep(),
      initiative: fixtureInitiative(),
      budgetProfile: "tiny",
      budgetRemainingUsdEstimate: 0.25,
      blastRadius: "low",
      securitySensitivity: "low",
      contextSize: "small",
      runnerAvailability: ["local-shell", "api"],
      relevantFiles: ["src/feature.ts", "src/legacy/*", "src/helper.ts"],
      testFiles: ["tests/feature.test.ts"],
      now: new Date("2026-05-04T06:00:00.000Z"),
      attemptId: "attempt_001",
    });

    expect(decision.status).toBe("scheduled");
    expect(decision.agentRole).toBe("executor");
    expect(decision.modelCapability).toBe("mid");
    expect(decision.runner).toBe("local-shell");
    expect(decision.contextLevel).toBe("L0");
    expect(decision.routingReason).toContain("budget_constrained_downgrade");
    expect(
      existsSync(
        path.join(cwd, ".kiwi", "runs", "run_demo", "steps", "step_001", "attempt_001", "context-package.json"),
      ),
    ).toBe(true);

    const contextPackage = loadContextPackage({
      cwd,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
    });
    expect(contextPackage.include.relevantFiles).toEqual(["src/feature.ts", "src/helper.ts"]);
    expect(
      loadSchedulerDecision({ cwd, runId: "run_demo", stepId: "step_001", attemptId: "attempt_001" }).routingReason,
    ).toContain("runner_selected:local-shell");
  });

  it("enforces risk-over-budget for high-risk steps", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-scheduler-high-risk-"));
    const decision = scheduleStepAttempt({
      cwd,
      runId: "run_demo",
      step: fixtureStep(),
      initiative: fixtureInitiative({ riskProfile: "production", budgetProfile: "tiny" }),
      budgetProfile: "tiny",
      budgetRemainingUsdEstimate: 0,
      blastRadius: "high",
      securitySensitivity: "high",
      contextSize: "medium",
      runnerAvailability: ["api"],
      relevantFiles: ["src/auth/service.ts"],
      now: new Date("2026-05-04T06:00:00.000Z"),
      attemptId: "attempt_002",
    });

    expect(decision.status).toBe("scheduled");
    expect(decision.agentRole).toBe("security");
    expect(decision.modelCapability).toBe("strong");
    expect(decision.reviewDepth).toBe("frontier");
    expect(decision.requiredGates).toContain("forbidden_file_checks");
    expect(decision.requiredGates).toContain("secrets_check");
    expect(decision.contextLevel).toBe("L3");
    expect(decision.routingReason).toContain("risk_over_budget_hard_cap_override");
  });

  it("caps low-risk cheap capability to L0 context", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-scheduler-cheap-cap-"));
    const decision = scheduleStepAttempt({
      cwd,
      runId: "run_demo",
      step: fixtureStep({ recommendedModelCapability: "cheap" }),
      initiative: fixtureInitiative(),
      budgetProfile: "normal",
      budgetRemainingUsdEstimate: 12,
      blastRadius: "low",
      securitySensitivity: "low",
      contextSize: "large",
      runnerAvailability: ["local-shell"],
      now: new Date("2026-05-04T06:00:00.000Z"),
      attemptId: "attempt_cheap_cap",
    });

    expect(decision.modelCapability).toBe("cheap");
    expect(decision.contextLevel).toBe("L0");
    expect(decision.routingReason).toContain("cheap_capability_l0_cap");
  });

  it("caps low-risk mid capability to L1 context", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-scheduler-mid-cap-"));
    const decision = scheduleStepAttempt({
      cwd,
      runId: "run_demo",
      step: fixtureStep({ recommendedModelCapability: "mid" }),
      initiative: fixtureInitiative(),
      budgetProfile: "normal",
      budgetRemainingUsdEstimate: 12,
      blastRadius: "low",
      securitySensitivity: "low",
      contextSize: "large",
      runnerAvailability: ["local-shell"],
      now: new Date("2026-05-04T06:00:00.000Z"),
      attemptId: "attempt_mid_cap",
    });

    expect(decision.modelCapability).toBe("mid");
    expect(decision.contextLevel).toBe("L1");
    expect(decision.routingReason).toContain("mid_capability_l1_cap");
  });

  it("keeps low-risk frontier capability at L2 for large context", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-scheduler-frontier-context-"));
    const decision = scheduleStepAttempt({
      cwd,
      runId: "run_demo",
      step: fixtureStep({ recommendedModelCapability: "frontier" }),
      initiative: fixtureInitiative(),
      budgetProfile: "normal",
      budgetRemainingUsdEstimate: 12,
      blastRadius: "low",
      securitySensitivity: "low",
      contextSize: "large",
      runnerAvailability: ["local-shell"],
      now: new Date("2026-05-04T06:00:00.000Z"),
      attemptId: "attempt_frontier_context",
    });

    expect(decision.modelCapability).toBe("frontier");
    expect(decision.contextLevel).toBe("L2");
    expect(decision.routingReason).not.toContain("cheap_capability_l0_cap");
    expect(decision.routingReason).not.toContain("mid_capability_l1_cap");
  });

  it("blocks low-risk steps when the hard budget cap is exhausted", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-scheduler-budget-blocked-"));
    const decision = scheduleStepAttempt({
      cwd,
      runId: "run_demo",
      step: fixtureStep(),
      initiative: fixtureInitiative({ budgetProfile: "tiny" }),
      budgetProfile: "tiny",
      budgetRemainingUsdEstimate: 0,
      blastRadius: "low",
      securitySensitivity: "low",
      contextSize: "small",
      runnerAvailability: ["local-shell"],
      now: new Date("2026-05-04T06:00:00.000Z"),
      attemptId: "attempt_budget",
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockedReason).toBe("budget_hard_cap_exhausted");
    expect(decision.routingReason).toContain("budget_hard_cap_exhausted");
  });

  it("returns blocked when no runner is available", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-scheduler-blocked-"));
    const decision = scheduleStepAttempt({
      cwd,
      runId: "run_demo",
      step: fixtureStep(),
      initiative: fixtureInitiative(),
      budgetProfile: "normal",
      budgetRemainingUsdEstimate: null,
      blastRadius: "low",
      securitySensitivity: "low",
      contextSize: "small",
      runnerAvailability: [],
      now: new Date("2026-05-04T06:00:00.000Z"),
      attemptId: "attempt_003",
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockedReason).toBe("no_runner_available");
  });

  it("writes scheduler and context audit events", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-scheduler-audit-"));
    scheduleStepAttempt({
      cwd,
      runId: "run_demo",
      step: fixtureStep(),
      initiative: fixtureInitiative(),
      budgetProfile: "normal",
      budgetRemainingUsdEstimate: null,
      blastRadius: "low",
      securitySensitivity: "low",
      contextSize: "large",
      runnerAvailability: ["local-shell"],
      relevantFiles: ["src/a.ts", "src/b.ts"],
      now: new Date("2026-05-04T06:00:00.000Z"),
      attemptId: "attempt_004",
    });

    const events = readAuditEvents(cwd, "run_demo");
    expect(events.some((event) => event.eventType === "scheduler_routing_decided")).toBe(true);
    expect(events.some((event) => event.eventType === "context_package_created")).toBe(true);
  });
});
