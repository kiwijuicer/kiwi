import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { KiwiPolicy, ModelEntry } from "@kiwi/contracts";
import { readAuditEvents } from "@kiwi/core";
import { ReviewerProvider } from "@kiwi/adapters";
import { ProviderReviewEngine } from "../provider-review-engine";
import { ReviewerProviderRegistry } from "../reviewer-provider-registry";

const policy: KiwiPolicy = {
  version: "1",
  project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
  commands: { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
  routing: { defaultAgentRole: "executor", defaultModelCapability: "strong", stepTypeOverrides: {} },
  riskZones: { high: [] },
  approvals: { requireFor: [], commandApprovalStates: {} },
  commandProfiles: {},
};

describe("provider review engine audit", () => {
  it("emits prompt_version_used for reviewer invocations", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-review-engine-"));
    const model: ModelEntry = {
      id: "reviewer-test-model",
      provider: "stub",
      capability: "strong",
      roles: ["reviewer"],
      accessMode: "claude-code-cli",
      enabled: true,
    };
    const provider: ReviewerProvider = {
      name: "stub-reviewer",
      async review() {
        return {
          providerName: "stub-reviewer",
          reviewVerdict: {
            verdict: "pass",
            safeToContinue: true,
            issues: [],
            recommendedNextSteps: ["Continue"],
            confidence: 0.9,
          },
          modelUsage: { inputTokens: 1, outputTokens: 1 },
          cost: { estimatedUsd: 0.01, currency: "USD" },
          providerArtifacts: {
            reviewerInput: { promptVersion: "reviewer/v1" },
            reviewerOutput: { promptVersion: "reviewer/v1" },
          },
        };
      },
    };
    const fakeRegistry = {
      select: () => ({ model, provider }),
      hasAvailableReviewer: () => true,
    };

    const engine = new ProviderReviewEngine({
      cwd,
      policy,
      registryModels: [model],
      reviewerProviderRegistry: fakeRegistry as unknown as ReviewerProviderRegistry,
    });

    await engine.reviewWithExecution({
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
      step: {
        stepId: "step_001",
        type: "coding",
        title: "Implement feature",
        dependsOn: [],
        successCriteria: ["done"],
        requiredGates: [],
        recommendedAgentRole: "executor",
        recommendedModelCapability: "strong",
        status: "pending",
      },
      gateResults: [],
      diff: "diff --git a/a.ts b/a.ts",
      diffHash: "sha256:test",
    });

    const promptEvent = readAuditEvents(cwd, "run_demo").find((event) => event.eventType === "prompt_version_used");
    expect(promptEvent?.payload).toMatchObject({
      phase: "reviewer",
      version: "reviewer/v1",
      modelId: "reviewer-test-model",
    });
  });
});
