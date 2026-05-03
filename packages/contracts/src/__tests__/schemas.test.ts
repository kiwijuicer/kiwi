import { describe, expect, it } from "vitest";
import {
  ArtifactSchema,
  ContractsMetadataSchema,
  GateResultSchema,
  InitiativeSchema,
  KiwiPolicySchema,
  ModelRegistrySchema,
  ReviewVerdictSchema,
  RunSchema,
  StepAttemptSchema,
  TaskGraphSchema,
} from "../schemas";

describe("contracts schemas", () => {
  it("parses contracts metadata", () => {
    const parsed = ContractsMetadataSchema.parse({
      schemaVersion: "1",
      evolutionMode: "breaking_allowed",
    });
    expect(parsed.schemaVersion).toBe("1");
  });

  it("parses a minimal initiative", () => {
    const parsed = InitiativeSchema.parse({
      id: "init_demo",
      title: "Demo",
      rawInput: "demo input",
      source: "cli",
      repoPath: "/tmp/repo",
      riskProfile: "dev",
      budgetProfile: "normal",
      createdAt: "2026-05-03T19:00:00.000Z",
    });

    expect(parsed.id).toBe("init_demo");
  });

  it("parses a run manifest with canonical run schema", () => {
    const parsed = RunSchema.parse({
      runId: "run_demo",
      initiativeId: "init_demo",
      currentPlanId: "plan_demo",
      status: "planned",
      createdAt: "2026-05-03T19:00:00.000Z",
      updatedAt: "2026-05-03T19:00:00.000Z",
    });

    expect(parsed.runId).toBe("run_demo");
  });

  it("parses a valid task graph", () => {
    const parsed = TaskGraphSchema.parse({
      planId: "plan_demo",
      runId: "run_demo",
      initiativeId: "init_demo",
      summary: "Demo summary",
      acceptanceCriteria: ["Criteria 1"],
      assumptions: [],
      openQuestions: [],
      riskScore: 3,
      complexityScore: 2,
      createdAt: "2026-05-03T19:00:00.000Z",
      steps: [
        {
          stepId: "step_001",
          type: "planning",
          title: "Create plan",
          dependsOn: [],
          successCriteria: ["Plan is explicit"],
          requiredGates: [],
          recommendedAgentRole: "planner",
          recommendedModelCapability: "frontier",
          status: "pending",
        },
      ],
    });

    expect(parsed.steps).toHaveLength(1);
  });

  it("parses artifact, step attempt, gate result, and review verdict", () => {
    const artifact = ArtifactSchema.parse({
      type: "test_report",
      ref: "steps/step_001/attempt_001/artifacts/test-report.json",
      createdAt: "2026-05-03T19:00:00.000Z",
      metadata: { suite: "unit" },
    });

    const attempt = StepAttemptSchema.parse({
      attemptId: "attempt_001",
      stepId: "step_001",
      runner: "local-shell",
      agentRole: "executor",
      modelCapability: "strong",
      status: "completed",
      contextPackageRef: "steps/step_001/attempt_001/context-package.json",
      artifacts: [artifact],
      startedAt: "2026-05-03T19:00:00.000Z",
      completedAt: "2026-05-03T19:01:00.000Z",
    });

    const gate = GateResultSchema.parse({
      gateId: "gate_typecheck_001",
      gateType: "typecheck",
      status: "pass",
      evidenceRefs: ["steps/step_001/attempt_001/artifacts/typecheck-report.json"],
      reason: "No type errors",
    });

    const review = ReviewVerdictSchema.parse({
      verdict: "pass_with_comments",
      safeToContinue: true,
      issues: [
        {
          code: "NIT-001",
          title: "Minor naming cleanup",
          severity: "low",
        },
      ],
      recommendedNextSteps: ["Proceed to next step"],
      confidence: 0.86,
    });

    expect(attempt.artifacts).toHaveLength(1);
    expect(gate.status).toBe("pass");
    expect(review.verdict).toBe("pass_with_comments");
  });

  it("rejects invalid gate status", () => {
    const parsed = GateResultSchema.safeParse({
      gateId: "gate_1",
      gateType: "typecheck",
      status: "ok",
      evidenceRefs: [],
      reason: "invalid",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid review confidence", () => {
    const parsed = ReviewVerdictSchema.safeParse({
      verdict: "pass",
      safeToContinue: true,
      issues: [],
      recommendedNextSteps: [],
      confidence: 2,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid step attempt runner", () => {
    const parsed = StepAttemptSchema.safeParse({
      attemptId: "attempt_001",
      stepId: "step_001",
      runner: "unknown-runner",
      agentRole: "executor",
      modelCapability: "strong",
      status: "running",
      contextPackageRef: "ctx.json",
      artifacts: [],
      startedAt: "2026-05-03T19:00:00.000Z",
      completedAt: null,
    });

    expect(parsed.success).toBe(false);
  });

  it("parses policy and registry", () => {
    const policy = KiwiPolicySchema.parse({
      version: "1",
      project: {
        name: "ai-kiwi",
        language: "typescript",
        packageManager: "pnpm",
      },
      commands: {
        test: "pnpm test",
        lint: "pnpm lint",
        typecheck: "pnpm typecheck",
      },
      routing: {
        defaultAgentRole: "executor",
        defaultModelCapability: "mid",
        stepTypeOverrides: {},
      },
      riskZones: { high: [] },
      approvals: { requireFor: [] },
    });

    const registry = ModelRegistrySchema.parse({
      version: "1",
      models: [
        {
          id: "stub-mid",
          provider: "stub",
          capability: "mid",
          roles: ["executor"],
          enabled: true,
        },
      ],
    });

    expect(policy.version).toBe("1");
    expect(registry.models[0]?.id).toBe("stub-mid");
  });
});
