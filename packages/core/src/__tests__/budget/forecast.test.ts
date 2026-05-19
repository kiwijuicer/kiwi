import { describe, expect, it } from "vitest";
import { ModelEntry, TaskGraph } from "@kiwi/contracts";
import { buildRunCostForecast, firstBudgetProfileForCost } from "../../budget/forecast";

const graph: TaskGraph = {
  planId: "plan_demo",
  runId: "run_demo",
  initiativeId: "init_demo",
  summary: "Demo",
  steps: [
    {
      stepId: "step_001",
      type: "coding",
      title: "Implement",
      dependsOn: [],
      successCriteria: ["Done"],
      requiredGates: [],
      recommendedAgentRole: "executor",
      recommendedModelCapability: "strong",
      status: "pending",
    },
    {
      stepId: "step_002",
      type: "validation",
      title: "Validate",
      dependsOn: ["step_001"],
      successCriteria: ["Done"],
      requiredGates: [],
      recommendedAgentRole: "reviewer",
      recommendedModelCapability: "mid",
      status: "pending",
    },
  ],
  acceptanceCriteria: ["Done"],
  assumptions: [],
  openQuestions: [],
  riskScore: 1,
  complexityScore: 1,
  createdAt: "2026-05-08T10:00:00.000Z",
};
const registryModels: ModelEntry[] = [
  {
    id: "codex-cli-strong",
    provider: "local",
    capability: "strong",
    roles: ["executor", "reviewer"],
    accessMode: "codex-cli",
    enabled: true,
    pricing: { currency: "USD", inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
  },
  {
    id: "codex-cli-mid",
    provider: "local",
    capability: "mid",
    roles: ["executor", "reviewer"],
    accessMode: "codex-cli",
    enabled: true,
    pricing: { currency: "USD", inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 },
  },
];

describe("cost forecast", () => {
  it("builds a phase cost forecast for a TaskGraph", () => {
    const forecast = buildRunCostForecast({ taskGraph: graph, plannerCostUsd: 0.04, registryModels });
    expect(forecast.estimatedCostUsd).toBeGreaterThan(0.04);
    expect(forecast.phaseCostsUsd.planner).toBe(0.04);
    expect(forecast.phaseCostsUsd.execution).toBeGreaterThan(0);
    expect(forecast.phaseCostsUsd.review).toBeGreaterThan(0);
    expect(forecast.steps).toHaveLength(2);
  });

  it("finds the smallest budget profile that can cover a forecast", () => {
    expect(firstBudgetProfileForCost(0.2)).toBe("tiny");
    expect(firstBudgetProfileForCost(1.5)).toBe("small");
  });
});
