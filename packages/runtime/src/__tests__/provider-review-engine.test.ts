import { existsSync, mkdtempSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { KiwiPolicy, ModelEntry } from "@kiwi/contracts";
import { readAuditEvents, resolveRunArtifactPath } from "@kiwi/core";
import { ReviewerProvider } from "@kiwi/adapters";
import { ProviderReviewEngine } from "../provider-review-engine";
import { ReviewInput } from "../review-engine";
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

const model: ModelEntry = {
  id: "reviewer-test-model",
  provider: "stub",
  capability: "strong",
  roles: ["reviewer"],
  accessMode: "claude-code-cli",
  enabled: true,
};

const reviewInput: ReviewInput = {
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
};

describe("provider review engine audit", () => {
  it("emits prompt_version_used for reviewer invocations", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-review-engine-"));
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

    await engine.reviewWithExecution(reviewInput);

    const promptEvent = readAuditEvents(cwd, "run_demo").find((event) => event.eventType === "prompt_version_used");
    expect(promptEvent?.payload).toMatchObject({
      phase: "reviewer",
      version: "reviewer/v1",
      modelId: "reviewer-test-model",
    });
  });

  it("persists invalid reviewer artifacts on ReviewVerdict validation failure", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-review-engine-invalid-"));
    let calls = 0;
    const provider: ReviewerProvider = {
      name: "stub-reviewer",
      async review() {
        calls += 1;
        const invalidVerdict = { verdict: "pass", safeToContinue: true };
        return {
          providerName: "stub-reviewer",
          reviewVerdict: invalidVerdict,
          modelUsage: { inputTokens: 1, outputTokens: 1 },
          cost: { estimatedUsd: 0.01, currency: "USD" },
          providerArtifacts: {
            reviewerInput: { promptVersion: "reviewer/v1", attempts: [{ attempt: calls }] },
            reviewerOutput: { promptVersion: "reviewer/v1", reviewVerdict: invalidVerdict },
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
      maxAttempts: 2,
    });

    await expect(engine.reviewWithExecution(reviewInput)).rejects.toThrow(
      "Reviewer provider stub-reviewer returned invalid ReviewVerdict after 2 attempts",
    );

    const outputPath = resolveRunArtifactPath(
      reviewInput.runId,
      "steps/step_001/attempt_001/artifacts/reviewer-output.json",
      cwd,
    );
    expect(existsSync(outputPath)).toBe(true);
    const reviewerOutput = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<string, unknown>;
    expect(reviewerOutput.validation).toMatchObject({
      schema: "ReviewVerdictSchema",
      valid: false,
      attemptsUsed: 2,
      invalidAttempts: 2,
    });
    expect(reviewerOutput.reviewVerdict).toEqual({ verdict: "pass", safeToContinue: true });

    const events = readAuditEvents(cwd, reviewInput.runId);
    expect(events.filter((event) => event.eventType === "reviewer_retry")).toHaveLength(2);
    const validationEvent = events.find((event) => event.eventType === "reviewer_validation_failed");
    expect(validationEvent?.payload).toMatchObject({
      stepId: "step_001",
      attemptId: "attempt_001",
      attemptsUsed: 2,
      reviewerOutputRef: "steps/step_001/attempt_001/artifacts/reviewer-output.json",
    });
  });
});
