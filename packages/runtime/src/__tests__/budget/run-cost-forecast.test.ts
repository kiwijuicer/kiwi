import { describe, expect, it } from "vitest";
import type { KiwiPolicy, ModelEntry, TaskGraph } from "@kiwi/contracts";
import { RunCostForecastService } from "../../budget/run-cost-forecast.js";

const pricing = {
  currency: "USD" as const,
  inputUsdPerMillion: 2,
  outputUsdPerMillion: 8,
  source: "test",
  sourceUrl: "https://example.com/pricing",
  sourceVersion: "test",
  pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z",
};

const policy: KiwiPolicy = {
  version: "1",
  project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
  commands: { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
  routing: {
    defaultAgentRole: "executor",
    defaultModelCapability: "mid",
    providerPreference: { executor: ["codex-cli"], reviewer: ["codex-cli"] },
    stepTypeOverrides: {},
  },
  riskZones: { high: [] },
  approvals: { requireFor: [], commandApprovalStates: {} },
  commandProfiles: {},
};

const graph: TaskGraph = {
  planId: "plan_demo",
  runId: "run_demo",
  initiativeId: "init_demo",
  summary: "Demo",
  acceptanceCriteria: ["works"],
  assumptions: [],
  openQuestions: [],
  riskScore: 1,
  complexityScore: 1,
  createdAt: "2026-05-19T00:00:00.000Z",
  steps: [
    {
      stepId: "step_001",
      type: "coding",
      title: "Implement",
      dependsOn: [],
      successCriteria: ["done"],
      requiredGates: [],
      recommendedAgentRole: "executor",
      recommendedModelCapability: "strong",
      status: "pending",
    },
  ],
};

function model(
  id: string,
  accessMode: ModelEntry["accessMode"],
  providerModel?: string,
  pricingOverride: ModelEntry["pricing"] = pricing,
): ModelEntry {
  return {
    id,
    ...(providerModel ? { providerModel } : {}),
    provider: accessMode === "stub" ? "stub" : "local",
    capability: "strong",
    roles: ["executor", "reviewer"],
    pricing: pricingOverride,
    accessMode,
    enabled: true,
  };
}

describe("RunCostForecastService", () => {
  it("uses available real runtime selectors instead of cheaper stubs", () => {
    const forecast = new RunCostForecastService().build({
      taskGraph: graph,
      policy,
      registry: {
        version: "1",
        catalogVersion: "test",
        models: [model("stub-strong", "stub"), model("codex-strong", "codex-cli", "gpt-5.4")],
      },
      plannerCostUsd: 0.01,
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1", KIWI_TEST_ALLOW_STUB: "1", KIWI_FORCE_ACCESS_MODE: "stub" },
    });

    expect(forecast.status).toBe("ok");
    expect(forecast.steps[0]?.executorModelId).toBe("codex-strong");
    expect(forecast.steps[0]?.reviewerModelId).toBe("codex-strong");
    expect(forecast.estimatedCostUsd).toBeGreaterThan(0.01);
  });

  it("blocks when only stubs are available for production cost guards", () => {
    const forecast = new RunCostForecastService().build({
      taskGraph: graph,
      policy,
      registry: { version: "1", models: [model("stub-strong", "stub")] },
      env: { KIWI_TEST_ALLOW_STUB: "1", KIWI_FORCE_ACCESS_MODE: "stub" },
    });

    expect(forecast.status).toBe("blocked");
    expect(forecast.blockedReasons.join("\n")).toContain("No available executor model");
  });

  it("blocks real models with zero pricing", () => {
    const forecast = new RunCostForecastService().build({
      taskGraph: graph,
      policy,
      registry: {
        version: "1",
        models: [
          model("codex-unpriced", "codex-cli", "gpt-5.4", {
            ...pricing,
            inputUsdPerMillion: 0,
            outputUsdPerMillion: 0,
          }),
        ],
      },
      env: { KIWI_FAKE_BINARY_AVAILABLE: "1" },
    });

    expect(forecast.status).toBe("blocked");
    expect(forecast.blockedReasons.join("\n")).toContain("Missing real pricing");
  });
});
