import { describe, expect, it } from "vitest";
import { KiwiPolicy } from "@kiwi/contracts";
import { AnthropicPlannerProvider } from "../../integrations/anthropic/planner-provider";
import { PlannerProviderInput, runPlannerProviderWithRetries } from "../../providers/planner";

const policy: KiwiPolicy = {
  version: "1",
  project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
  commands: { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
  routing: {
    defaultAgentRole: "executor",
    defaultModelCapability: "mid",
    providerPreference: {},
    stepTypeOverrides: {
      planning: { agentRole: "planner", modelCapability: "frontier" },
    },
  },
  riskZones: { high: [] },
  approvals: { requireFor: [], commandApprovalStates: {} },
  commandProfiles: {},
};

const input: PlannerProviderInput = {
  runId: "run_20260504_120000_live",
  initiative: {
    id: "init_20260504_120000_live",
    title: "Live provider smoke",
    rawInput: "Plan a tiny documentation-only change and validation.",
    source: "cli",
    repoPath: process.cwd(),
    riskProfile: "dev",
    budgetProfile: "tiny",
    createdAt: "2026-05-04T12:00:00.000Z",
  },
  policy,
  requestedAt: "2026-05-04T12:00:00.000Z",
};

describe.skipIf(process.env.KIWI_LIVE_PROVIDER !== "1")("AnthropicPlannerProvider live", () => {
  it("returns a schema-valid TaskGraph from Anthropic", async () => {
    const provider = new AnthropicPlannerProvider({
      model: process.env.KIWI_LIVE_PLANNER_MODEL ?? "claude-opus-4-7",
      maxTokens: 4096,
    });

    const output = await runPlannerProviderWithRetries(provider, input, { maxAttempts: 2 });

    expect(output.validation.valid).toBe(true);
    expect(output.taskGraph.runId).toBe(input.runId);
    expect(output.modelUsage.inputTokens).toBeGreaterThan(0);
    expect(output.cost.estimatedUsd).toBeGreaterThan(0);
  });
});
