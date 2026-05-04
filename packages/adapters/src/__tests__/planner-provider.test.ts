import { describe, expect, it } from "vitest";
import { KiwiPolicy, TaskGraph } from "@kiwi/contracts";
import {
  PlannerProviderValidationError,
  PlannerProvider,
  PlannerProviderInput,
  PlannerProviderOutput,
  runPlannerProviderWithRetries,
} from "../planner-provider";
import { StubPlannerProvider } from "../stub-planner-provider";

const policy: KiwiPolicy = {
  version: "1",
  project: {
    name: "kiwi",
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
  approvals: { requireFor: [], commandApprovalStates: {} },
  commandProfiles: {},
};

const input: PlannerProviderInput = {
  runId: "run_20260503_190000_abcd",
  initiative: {
    id: "init_20260503_190000_abcd",
    title: "Feature: Roles",
    rawInput: "# Feature: Roles\n\n## Plan implementation",
    source: "cli",
    repoPath: "/tmp/repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-03T19:00:00.000Z",
  },
  policy,
  requestedAt: "2026-05-03T19:00:00.000Z",
};

function validTaskGraph(): TaskGraph {
  return {
    planId: "plan_20260503_190000_abcd",
    runId: input.runId,
    initiativeId: input.initiative.id,
    summary: "Demo graph",
    steps: [
      {
        stepId: "step_001",
        type: "planning",
        title: "Plan implementation",
        dependsOn: [],
        successCriteria: ["Plan is explicit"],
        requiredGates: [],
        recommendedAgentRole: "planner",
        recommendedModelCapability: "frontier",
        status: "pending",
      },
    ],
    acceptanceCriteria: ["works"],
    assumptions: [],
    openQuestions: [],
    riskScore: 2,
    complexityScore: 2,
    createdAt: "2026-05-03T19:00:00.000Z",
  };
}

describe("planner provider", () => {
  it("validates stub provider output", async () => {
    const provider = new StubPlannerProvider({
      buildTaskGraph: () => validTaskGraph(),
    });

    const output = await runPlannerProviderWithRetries(provider, input);

    expect(output.providerName).toBe("stub-deterministic");
    expect(output.taskGraph.planId).toBe("plan_20260503_190000_abcd");
    expect(output.validation.valid).toBe(true);
    expect(output.cost.estimatedUsd).toBe(0);
    expect(output.retry.attemptsUsed).toBe(1);
    expect(output.retry.invalidAttempts).toBe(0);
    expect(output.retry.records).toHaveLength(1);
    expect(output.retry.records[0]?.status).toBe("valid");
  });

  it("retries invalid output before accepting valid output", async () => {
    let calls = 0;
    const provider: PlannerProvider = {
      name: "flaky-planner",
      async plan(): Promise<PlannerProviderOutput> {
        calls += 1;
        return {
          providerName: "flaky-planner",
          taskGraph: calls === 1 ? { invalid: true } : validTaskGraph(),
          modelUsage: { inputTokens: 0, outputTokens: 0 },
          cost: { estimatedUsd: 0, currency: "USD" },
        };
      },
    };

    const output = await runPlannerProviderWithRetries(provider, input, { maxAttempts: 2 });

    expect(output.attempts).toBe(2);
    expect(output.taskGraph.planId).toBe("plan_20260503_190000_abcd");
    expect(output.retry.attemptsUsed).toBe(2);
    expect(output.retry.invalidAttempts).toBe(1);
    expect(output.retry.records[0]?.status).toBe("invalid");
    expect(output.retry.records[1]?.status).toBe("valid");
  });

  it("fails when provider output stays invalid", async () => {
    const provider: PlannerProvider = {
      name: "always-invalid",
      async plan(): Promise<PlannerProviderOutput> {
        return {
          providerName: "always-invalid",
          taskGraph: { invalid: true },
          modelUsage: { inputTokens: 0, outputTokens: 0 },
          cost: { estimatedUsd: 0, currency: "USD" },
        };
      },
    };

    await expect(runPlannerProviderWithRetries(provider, input, { maxAttempts: 2 })).rejects.toMatchObject({
      name: "PlannerProviderValidationError",
      evidence: {
        providerName: "always-invalid",
        maxAttempts: 2,
        attemptsUsed: 2,
      },
    });
  });
});
