import { describe, expect, it } from "vitest";
import { GateResult, KiwiPolicy, ReviewVerdict } from "@kiwi/contracts";
import {
  AnthropicReviewerHttpRequest,
  AnthropicReviewerProvider,
  AnthropicReviewerTransport,
} from "../../integrations/anthropic/reviewer-provider";
import { ReviewerProviderInput, runReviewerProviderWithRetries } from "../../providers/reviewer";

const policy: KiwiPolicy = {
  version: "1",
  project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
  commands: { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
  routing: {
    defaultAgentRole: "executor",
    defaultModelCapability: "mid",
    providerPreference: {},
    stepTypeOverrides: {
      review: { agentRole: "reviewer", modelCapability: "frontier" },
    },
  },
  riskZones: { high: ["src/auth/**"] },
  approvals: { requireFor: [], commandApprovalStates: {} },
  commandProfiles: {
    default: {
      allowedCommands: ["pnpm"],
      approvalState: "auto",
      approvalRequiredPaths: [],
      deniedPaths: [".env*"],
      envAllowlist: ["PATH"],
      secretEnvNames: ["KIWI_SECRET"],
      networkPolicy: "disabled",
      timeoutMs: 120_000,
      maxOutputBytes: 65_536,
    },
  },
};

const passingGate: GateResult = {
  gateId: "gate_typecheck",
  gateType: "typecheck",
  status: "pass",
  evidenceRefs: ["steps/step_001/attempt_001/artifacts/typecheck-report.json"],
  reason: "tsc completed without errors",
};

const sampleDiff = `diff --git a/src/feature.ts b/src/feature.ts
--- a/src/feature.ts
+++ b/src/feature.ts
@@
-const x = 1;
+const x = 2;
`;

const input: ReviewerProviderInput = {
  runId: "run_20260504_120000_abcd",
  stepId: "step_001",
  attemptId: "attempt_001",
  step: {
    stepId: "step_001",
    type: "coding",
    title: "Update feature constant",
    successCriteria: ["constant updated"],
    requiredGates: ["typecheck"],
  },
  diff: sampleDiff,
  diffHash: "sha256:abcd1234",
  gateResults: [passingGate],
  requestedAt: "2026-05-04T12:00:00.000Z",
};

function passingVerdict(): ReviewVerdict {
  return {
    verdict: "pass",
    safeToContinue: true,
    issues: [],
    recommendedNextSteps: ["Continue to next step"],
    confidence: 0.9,
  };
}

function anthropicResponse(verdict: unknown) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: "emit_review_verdict",
        input: verdict,
      },
    ],
    usage: {
      input_tokens: 500,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 1500,
      output_tokens: 800,
    },
  };
}

describe("AnthropicReviewerProvider", () => {
  it("sends cached structured reviewer requests and extracts real usage cost", async () => {
    let captured: AnthropicReviewerHttpRequest | undefined;
    const transport: AnthropicReviewerTransport = async (request) => {
      captured = request;

      return { ok: true, status: 200, body: anthropicResponse(passingVerdict()) };
    };
    const provider = new AnthropicReviewerProvider({
      apiKey: "sk-ant-test-key",
      model: "claude-sonnet-4-6",
      transport,
      env: { KIWI_SECRET: "env-secret" },
      policy,
    });

    const output = await runReviewerProviderWithRetries(provider, input);

    expect(output.providerName).toBe("anthropic:claude-sonnet-4-6");
    expect(output.modelUsage).toEqual({ inputTokens: 3000, outputTokens: 800 });
    expect(output.cost.currency).toBe("USD");
    expect(output.cost.estimatedUsd).toBeGreaterThan(0);
    expect(output.reviewVerdict.verdict).toBe("pass");
    expect(captured?.body.tool_choice).toEqual({ type: "tool", name: "emit_review_verdict" });
    expect(captured?.body.system).toHaveLength(3);
    expect(captured?.body.system.every((block) => block.cache_control?.type === "ephemeral")).toBe(true);
    expect(captured?.body.tools[0]?.cache_control?.type).toBe("ephemeral");
  });

  it("uses a bounded repair turn when the first ReviewVerdict is invalid", async () => {
    const requests: AnthropicReviewerHttpRequest[] = [];
    const transport: AnthropicReviewerTransport = async (request) => {
      requests.push(request);

      return {
        ok: true,
        status: 200,
        body: anthropicResponse(requests.length === 1 ? { invalid: true } : passingVerdict()),
      };
    };
    const provider = new AnthropicReviewerProvider({
      apiKey: "sk-ant-test-key",
      transport,
      env: { KIWI_SECRET: "env-secret" },
      policy,
    });

    const output = await runReviewerProviderWithRetries(provider, input, { maxAttempts: 2 });

    expect(output.retry.attemptsUsed).toBe(2);
    expect(output.retry.invalidAttempts).toBe(1);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.body.messages)).toContain("Repair the previous ReviewVerdict");
    expect(JSON.stringify(output.providerArtifacts?.reviewerInput)).toContain('"attemptType":"repair"');
  });

  it("redacts secrets from the request and persisted artifacts", async () => {
    const verdict = passingVerdict();
    let captured: AnthropicReviewerHttpRequest | undefined;
    const transport: AnthropicReviewerTransport = async (request) => {
      captured = request;

      return { ok: true, status: 200, body: anthropicResponse(verdict) };
    };
    const provider = new AnthropicReviewerProvider({
      apiKey: "sk-ant-test-key",
      transport,
      env: { KIWI_SECRET: "leak-me" },
      policy,
    });
    const inputWithSecret: ReviewerProviderInput = {
      ...input,
      diff: `${sampleDiff}\n+ const apiKey = "leak-me";`,
    };

    const output = await provider.review(inputWithSecret);

    const requestText = JSON.stringify(captured?.body);
    expect(requestText).not.toContain("leak-me");
    const artifactText = JSON.stringify(output.providerArtifacts);
    expect(artifactText).not.toContain("leak-me");
    expect(artifactText).toContain("[REDACTED]");
  });

  it("maps rate limits to a typed reviewer error", async () => {
    const provider = new AnthropicReviewerProvider({
      apiKey: "sk-ant-test-key",
      transport: async () => ({
        ok: false,
        status: 429,
        body: { error: { type: "rate_limit_error", message: "too many requests" } },
      }),
    });

    await expect(provider.review(input)).rejects.toMatchObject({
      name: "ReviewerProviderError",
      code: "provider_rate_limited",
      schedulerErrorCode: "SCHEDULER_REVIEWER_RATE_LIMIT",
      retryable: true,
    });
  });

  it("maps auth errors to a non-retryable reviewer error", async () => {
    const provider = new AnthropicReviewerProvider({
      apiKey: "sk-ant-test-key",
      transport: async () => ({
        ok: false,
        status: 401,
        body: { error: { type: "authentication_error", message: "invalid key" } },
      }),
    });

    await expect(provider.review(input)).rejects.toMatchObject({
      name: "ReviewerProviderError",
      code: "provider_auth",
      schedulerErrorCode: "SCHEDULER_REVIEWER_AUTH",
      retryable: false,
    });
  });
});
