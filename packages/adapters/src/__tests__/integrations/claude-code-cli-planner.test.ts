import { describe, expect, it } from "vitest";
import { KiwiPolicy, TaskGraph } from "@kiwi/contracts";
import { ClaudeCodeCliPlannerProvider } from "../../integrations/claude-code/planner-provider.js";
import {
  ClaudeCodeCliInvocation,
  ClaudeCodeCliResult,
  ClaudeCodeCliRunner,
} from "../../integrations/claude-code/client.js";
import { runPlannerProviderWithRetries, PlannerProviderInput } from "../../providers/planner.js";

const policy: KiwiPolicy = {
  version: "1",
  project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
  commands: { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
  routing: {
    defaultAgentRole: "executor",
    defaultModelCapability: "mid",
    providerPreference: {},
    stepTypeOverrides: {},
  },
  riskZones: { high: [] },
  approvals: { requireFor: [], commandApprovalStates: {} },
  commandProfiles: {
    default: {
      allowedCommands: ["pnpm"],
      approvalState: "auto",
      approvalRequiredPaths: [],
      deniedPaths: [],
      envAllowlist: ["PATH"],
      secretEnvNames: ["KIWI_SECRET"],
      networkPolicy: "disabled",
      timeoutMs: 60_000,
      maxOutputBytes: 65_536,
    },
  },
};

const input: PlannerProviderInput = {
  runId: "run_demo",
  initiative: {
    id: "init_demo",
    title: "Sample feature",
    rawInput: "Implement sample feature",
    source: "cli",
    repoPath: "/tmp/no-repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-04T12:00:00.000Z",
  },
  policy,
  requestedAt: "2026-05-04T12:00:00.000Z",
};

function validTaskGraph(): TaskGraph {
  return {
    planId: "plan_demo",
    runId: input.runId,
    initiativeId: input.initiative.id,
    summary: "Demo plan",
    steps: [
      {
        stepId: "step_001",
        type: "planning",
        title: "Plan",
        dependsOn: [],
        successCriteria: ["plan exists"],
        requiredGates: [],
        recommendedAgentRole: "planner",
        recommendedModelCapability: "frontier",
        status: "pending",
      },
    ],
    acceptanceCriteria: ["plan accepted"],
    assumptions: [],
    openQuestions: [],
    riskScore: 1,
    complexityScore: 1,
    createdAt: input.requestedAt,
  };
}

class StubCliRunner implements ClaudeCodeCliRunner {
  readonly invocations: ClaudeCodeCliInvocation[] = [];
  constructor(private readonly responses: Array<{ result: unknown; ok: boolean; cost?: number }>) {}
  async run(invocation: ClaudeCodeCliInvocation): Promise<ClaudeCodeCliResult> {
    this.invocations.push(invocation);
    const next = this.responses.shift() ?? { result: validTaskGraph(), ok: true };
    const stdout = JSON.stringify({
      type: "result",
      result: typeof next.result === "string" ? next.result : JSON.stringify(next.result),
      total_cost_usd: next.cost,
    });

    return {
      ok: next.ok,
      exitCode: next.ok ? 0 : 1,
      stdout,
      stderr: "",
      parsed: JSON.parse(stdout),
      durationMs: 5,
      startedAt: "2026-05-04T12:00:00.000Z",
      completedAt: "2026-05-04T12:00:00.005Z",
      binary: invocation.binary,
      args: ["-p", invocation.prompt, "--output-format", "json"],
      timedOut: false,
    };
  }
}

describe("ClaudeCodeCliPlannerProvider", () => {
  it("invokes the CLI runner and parses the JSON envelope", async () => {
    const runner = new StubCliRunner([{ result: validTaskGraph(), ok: true, cost: 0.0123 }]);
    const provider = new ClaudeCodeCliPlannerProvider({
      binary: "claude",
      runner,
      env: { KIWI_SECRET: "leak-me" },
    });

    const validated = await runPlannerProviderWithRetries(provider, input);

    expect(validated.providerName).toContain("claude-code-cli");
    expect(validated.cost.estimatedUsd).toBeCloseTo(0.0123, 5);
    expect(runner.invocations).toHaveLength(1);
    expect(runner.invocations[0]?.binary).toBe("claude");
  });

  it("supports schema-repair via repair envelope", async () => {
    const runner = new StubCliRunner([
      { result: { invalid: true }, ok: true },
      { result: validTaskGraph(), ok: true },
    ]);
    const provider = new ClaudeCodeCliPlannerProvider({ binary: "claude", runner });
    const validated = await runPlannerProviderWithRetries(provider, input, { maxAttempts: 2 });
    expect(validated.retry.attemptsUsed).toBe(2);
    expect(validated.retry.invalidAttempts).toBe(1);
    expect(runner.invocations).toHaveLength(2);
    expect(runner.invocations[1]?.prompt).toContain("Repair the previous TaskGraph");
  });

  it("surfaces JSON stdout errors when the CLI exits without stderr", async () => {
    const runner = new StubCliRunner([{ result: "Not logged in · Please run /login", ok: false }]);
    const provider = new ClaudeCodeCliPlannerProvider({ binary: "claude", runner });

    await expect(runPlannerProviderWithRetries(provider, input, { maxAttempts: 1 })).rejects.toThrow(
      "claude-code-cli planner exited 1: Not logged in",
    );
  });
});
