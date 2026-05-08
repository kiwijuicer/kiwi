import { describe, expect, it } from "vitest";
import { KiwiPolicy, TaskGraph } from "@kiwi/contracts";
import { CodexCliInvocation, CodexCliResult, CodexCliRunner } from "../codex-cli/client";
import { CodexCliPlannerProvider } from "../codex-cli/planner-provider";
import { CursorAgentCliInvocation, CursorAgentCliResult, CursorAgentCliRunner } from "../cursor-agent-cli/client";
import { CursorAgentPlannerProvider } from "../cursor-agent-cli/planner-provider";
import { PlannerProviderInput, runPlannerProviderWithRetries } from "../planner-provider";

const policy: KiwiPolicy = {
  version: "1",
  project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
  commands: { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
  routing: { defaultAgentRole: "executor", defaultModelCapability: "mid", providerPreference: {}, stepTypeOverrides: {} },
  riskZones: { high: [] },
  approvals: { requireFor: [], commandApprovalStates: {} },
  commandProfiles: {},
};

const input: PlannerProviderInput = {
  runId: "run_20260503_190000_abcd",
  initiative: {
    id: "init_20260503_190000_abcd",
    title: "Feature: Start",
    rawInput: "# Feature: Start\n\nAdd interactive command",
    source: "cli",
    repoPath: "/tmp/repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-03T19:00:00.000Z",
  },
  policy,
  requestedAt: "2026-05-03T19:00:00.000Z",
};

function taskGraph(): TaskGraph {
  return {
    planId: "plan_20260503_190000_abcd",
    runId: input.runId,
    initiativeId: input.initiative.id,
    summary: "Add interactive command",
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
    subPlans: [
      {
        subPlanId: "subplan_1",
        title: "Implementation",
        stepIds: ["step_001"],
        dependsOn: [],
        maxConcurrency: 1,
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

class FakeCodexPlannerRunner implements CodexCliRunner {
  readonly invocations: CodexCliInvocation[] = [];

  async run(invocation: CodexCliInvocation): Promise<CodexCliResult> {
    this.invocations.push(invocation);
    const parsed = [
      {
        type: "item.completed",
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: JSON.stringify(taskGraph()) }],
        },
      },
      { type: "turn.completed", usage: { inputTokens: 13, outputTokens: 5 } },
    ];
    return {
      ok: true,
      exitCode: 0,
      stdout: parsed.map((entry) => JSON.stringify(entry)).join("\n"),
      stderr: "",
      parsed,
      durationMs: 10,
      startedAt: "2026-05-04T12:00:00.000Z",
      completedAt: "2026-05-04T12:00:00.010Z",
      binary: invocation.binary,
      args: ["exec", "--json", invocation.prompt],
      timedOut: false,
    };
  }
}

class FakeCursorPlannerRunner implements CursorAgentCliRunner {
  readonly invocations: CursorAgentCliInvocation[] = [];

  async run(invocation: CursorAgentCliInvocation): Promise<CursorAgentCliResult> {
    this.invocations.push(invocation);
    const parsed = {
      result: JSON.stringify(taskGraph()),
      usage: { input_tokens: 11, output_tokens: 7 },
      total_cost_usd: 0.123,
    };
    return {
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify(parsed),
      stderr: "",
      parsed,
      durationMs: 10,
      startedAt: "2026-05-04T12:00:00.000Z",
      completedAt: "2026-05-04T12:00:00.010Z",
      binary: invocation.binary,
      args: ["-p", invocation.prompt, "--output-format", "json"],
      timedOut: false,
    };
  }
}

describe("CLI planner providers", () => {
  it("plans through codex-cli JSONL output", async () => {
    const runner = new FakeCodexPlannerRunner();
    const provider = new CodexCliPlannerProvider({ runner, env: { PATH: "/bin", SECRET_TOKEN: "hidden" } });

    const output = await runPlannerProviderWithRetries(provider, input);

    expect(output.providerName).toBe("codex-cli:default");
    expect(output.taskGraph.planId).toBe("plan_20260503_190000_abcd");
    expect(output.modelUsage).toEqual({ inputTokens: 13, outputTokens: 5 });
    expect(runner.invocations[0]?.prompt).toContain("TaskGraph JSON schema");
    expect(runner.invocations[0]?.env?.SECRET_TOKEN).toBeUndefined();
  });

  it("plans through cursor-agent JSON output", async () => {
    const runner = new FakeCursorPlannerRunner();
    const provider = new CursorAgentPlannerProvider({ runner, env: { PATH: "/bin" } });

    const output = await runPlannerProviderWithRetries(provider, input);

    expect(output.providerName).toBe("cursor-agent-cli:default");
    expect(output.taskGraph.steps[0]?.title).toBe("Plan implementation");
    expect(output.cost.estimatedUsd).toBe(0.123);
    expect(runner.invocations[0]?.outputFormat).toBe("json");
  });
});
