import { describe, expect, it } from "vitest";
import {
  InitiativeSchema,
  KiwiPolicySchema,
  ModelRegistrySchema,
  TaskGraphSchema,
} from "../schemas";

describe("contracts schemas", () => {
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
