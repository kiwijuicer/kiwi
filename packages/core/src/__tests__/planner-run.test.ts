import { mkdtempSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { KiwiPolicy, ModelEntry } from "@kiwi/contracts";
import { readAuditEvents, loadPlannerCostReport } from "../cost-ledger";
import { readModelInvocations } from "../model-invocations";
import { buildDeterministicTaskGraph } from "../planner";
import { planRun } from "../planner-run";

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

const plannerModel: ModelEntry = {
  id: "stub-frontier",
  provider: "stub",
  capability: "frontier",
  roles: ["planner"],
  enabled: true,
};

function cwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-planner-run-"));
}

describe("planner run service", () => {
  it("writes planner artifacts, audit events, invocation evidence, and cost report", async () => {
    const workspacePath = cwd();
    const now = new Date("2026-05-04T12:00:00.000Z");

    const result = await planRun({
      workspacePath,
      repoId: "voice-core",
      repoPath: workspacePath,
      rawInput: "# Demo\n\n## Plan\n## Implement",
      source: "mcp",
      policy,
      plannerModel,
      runId: "run_20260504_120000_test",
      now,
      executePlanner: async (input, options) => {
        const taskGraph = buildDeterministicTaskGraph({
          runId: input.runId,
          initiative: input.initiative,
          policy: input.policy,
          now,
        });
        return {
          providerName: "stub-deterministic",
          taskGraph,
          modelUsage: { inputTokens: 10, outputTokens: 20 },
          cost: { estimatedUsd: 0.01, currency: "USD" },
          retry: {
            maxAttempts: options.maxAttempts,
            attemptsUsed: 1,
            invalidAttempts: 0,
            records: [
              {
                attempt: 1,
                providerName: "stub-deterministic",
                status: "valid",
                modelUsage: { inputTokens: 10, outputTokens: 20 },
                cost: { estimatedUsd: 0.01, currency: "USD" },
              },
            ],
          },
        };
      },
    });

    expect(result.modelInvocationRef).toContain("model-invocations.jsonl#planner");

    const invocations = readModelInvocations(workspacePath, result.runId);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      phase: "planner",
      modelId: "stub-frontier",
      providerName: "stub-deterministic",
      usage: { inputTokens: 10, outputTokens: 20 },
      estimatedCostUsd: 0.01,
    });

    const cost = loadPlannerCostReport(workspacePath, result.runId);
    expect(cost).toMatchObject({
      plannerModelId: "stub-frontier",
      providerName: "stub-deterministic",
      attemptsUsed: 1,
    });

    const auditTypes = readAuditEvents(workspacePath, result.runId).map((event) => event.eventType);
    expect(auditTypes).toEqual([
      "planner_provider_selected",
      "planner_succeeded",
      "model_invocation_recorded",
    ]);

    const plannerOutput = JSON.parse(
      readFileSync(path.join(workspacePath, ".kiwi", "runs", result.runId, "plan", "planner-output.json"), "utf-8"),
    ) as { modelInvocationRef?: string };
    expect(plannerOutput.modelInvocationRef).toBe(result.modelInvocationRef);
  });
});
