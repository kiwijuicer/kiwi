import { describe, expect, it } from "vitest";
import { KiwiPolicy, TaskGraph } from "@kiwi/contracts";
import {
  AnthropicPlannerHttpRequest,
  AnthropicPlannerProvider,
  AnthropicPlannerTransport,
} from "../../integrations/anthropic/planner-provider";
import { PlannerProviderInput, runPlannerProviderWithRetries } from "../../providers/planner";

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
    providerPreference: {},
    stepTypeOverrides: {
      planning: {
        agentRole: "planner",
        modelCapability: "frontier",
      },
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

const input: PlannerProviderInput = {
  runId: "run_20260504_120000_abcd",
  initiative: {
    id: "init_20260504_120000_abcd",
    title: "Feature: Roles",
    rawInput: "# Feature: Roles\n\nAdd planner support. api_key=detected-secret secret=env-secret",
    source: "cli",
    repoPath: "/tmp/not-a-real-repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-04T12:00:00.000Z",
  },
  policy,
  requestedAt: "2026-05-04T12:00:00.000Z",
};

function validTaskGraph(): TaskGraph {
  return {
    planId: "plan_20260504_120000_abcd",
    runId: input.runId,
    initiativeId: input.initiative.id,
    summary: "Implement planner support",
    steps: [
      {
        stepId: "step_001",
        type: "planning",
        title: "Plan provider integration",
        dependsOn: [],
        successCriteria: ["TaskGraph is explicit"],
        requiredGates: [],
        recommendedAgentRole: "planner",
        recommendedModelCapability: "frontier",
        status: "pending",
      },
    ],
    acceptanceCriteria: ["Planner provider works"],
    assumptions: [],
    openQuestions: [],
    riskScore: 2,
    complexityScore: 3,
    createdAt: input.requestedAt,
  };
}

function anthropicResponse(taskGraph: unknown) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: "emit_task_graph",
        input: taskGraph,
      },
    ],
    usage: {
      input_tokens: 1000,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 3000,
      output_tokens: 4000,
    },
  };
}

describe("AnthropicPlannerProvider", () => {
  it("sends cached structured planner requests and extracts real usage cost", async () => {
    let captured: AnthropicPlannerHttpRequest | undefined;
    const transport: AnthropicPlannerTransport = async (request) => {
      captured = request;

      return { ok: true, status: 200, body: anthropicResponse(validTaskGraph()) };
    };
    const provider = new AnthropicPlannerProvider({
      apiKey: "sk-ant-test-key",
      model: "claude-opus-4-6",
      transport,
      env: { KIWI_SECRET: "env-secret" },
    });

    const output = await runPlannerProviderWithRetries(provider, input);

    expect(output.providerName).toBe("anthropic:claude-opus-4-6");
    expect(output.modelUsage).toEqual({ inputTokens: 6000, outputTokens: 4000 });
    expect(output.cost).toEqual({ estimatedUsd: 0.119, currency: "USD" });
    expect(output.taskGraph.planId).toBe("plan_20260504_120000_abcd");
    expect(captured?.body.tool_choice).toEqual({ type: "tool", name: "emit_task_graph" });
    expect(captured?.body.system.every((block) => block.cache_control?.type === "ephemeral")).toBe(true);
    expect(captured?.body.tools[0]?.cache_control?.type).toBe("ephemeral");

    const requestText = JSON.stringify(captured?.body);
    expect(requestText).not.toContain("env-secret");
    expect(requestText).not.toContain("detected-secret");

    const artifactText = JSON.stringify(output.providerArtifacts);
    expect(artifactText).not.toContain("env-secret");
    expect(artifactText).not.toContain("detected-secret");
    expect(artifactText).toContain("[REDACTED]");
  });

  it("uses a bounded repair turn when the first TaskGraph is invalid", async () => {
    const requests: AnthropicPlannerHttpRequest[] = [];
    const transport: AnthropicPlannerTransport = async (request) => {
      requests.push(request);

      return {
        ok: true,
        status: 200,
        body: anthropicResponse(requests.length === 1 ? { invalid: true } : validTaskGraph()),
      };
    };
    const provider = new AnthropicPlannerProvider({
      apiKey: "sk-ant-test-key",
      transport,
      env: { KIWI_SECRET: "env-secret" },
    });

    const output = await runPlannerProviderWithRetries(provider, input, { maxAttempts: 2 });

    expect(output.retry.attemptsUsed).toBe(2);
    expect(output.retry.invalidAttempts).toBe(1);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.body.messages)).toContain("Repair the previous TaskGraph");
    expect(JSON.stringify(output.providerArtifacts?.plannerInput)).toContain('"attemptType":"repair"');
  });

  it("maps rate limits to a typed provider error", async () => {
    const provider = new AnthropicPlannerProvider({
      apiKey: "sk-ant-test-key",
      transport: async () => ({
        ok: false,
        status: 429,
        body: { error: { type: "rate_limit_error", message: "too many requests" } },
      }),
    });

    await expect(provider.plan(input)).rejects.toMatchObject({
      name: "PlannerProviderError",
      code: "provider_rate_limited",
      schedulerErrorCode: "SCHEDULER_PROVIDER_RATE_LIMIT",
      retryable: true,
    });
  });
});
