import { describe, expect, it } from "vitest";
import { KiwiPolicy } from "@kiwi/contracts";
import { ClaudeCodeCliInvocation, ClaudeCodeCliResult, ClaudeCodeCliRunner } from "../claude-code-cli/client";
import { ClaudeCodeCliReviewerProvider } from "../claude-code-cli/reviewer-provider";
import { CodexCliInvocation, CodexCliResult, CodexCliRunner } from "../codex-cli/client";
import { CodexCliResearcherProvider } from "../codex-cli/researcher-provider";
import { CodexCliReviewerProvider } from "../codex-cli/reviewer-provider";
import { CursorAgentCliInvocation, CursorAgentCliResult, CursorAgentCliRunner } from "../cursor-agent-cli/client";
import { CursorAgentResearcherProvider } from "../cursor-agent-cli/researcher-provider";
import { CursorAgentReviewerProvider } from "../cursor-agent-cli/reviewer-provider";
import { ResearcherProviderInput, runResearcherProviderWithRetries } from "../researcher-provider";
import { ReviewerProviderInput, runReviewerProviderWithRetries } from "../reviewer-provider";

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
      allowedCommands: ["node", "pnpm"],
      approvalState: "auto",
      approvalRequiredPaths: [],
      deniedPaths: [".env*"],
      envAllowlist: ["PATH", "CI"],
      secretEnvNames: [],
      networkPolicy: "disabled",
      timeoutMs: 120_000,
      maxOutputBytes: 65_536,
    },
  },
};

const reviewVerdict = {
  verdict: "pass",
  safeToContinue: true,
  issues: [],
  recommendedNextSteps: ["Continue with the next planned step"],
  confidence: 0.92,
};

const reviewInput: ReviewerProviderInput = {
  runId: "run_20260503_190000_abcd",
  stepId: "step_001",
  attemptId: "attempt_20260503_190000_abcd",
  step: {
    stepId: "step_001",
    type: "coding",
    title: "Add provider",
    successCriteria: ["Provider returns schema-valid output"],
    requiredGates: ["gate_tests"],
  },
  diff: "diff --git a/file.ts b/file.ts\n+export const ok = true;\n",
  diffHash: "sha256:test",
  gateResults: [
    {
      gateId: "gate_tests",
      gateType: "tests",
      status: "pass",
      evidenceRefs: ["artifact:test"],
      reason: "Tests passed",
    },
  ],
  requestedAt: "2026-05-03T19:00:00.000Z",
};

const researchInput: ResearcherProviderInput = {
  runId: "run_20260503_190000_abcd",
  initiative: {
    id: "init_20260503_190000_abcd",
    title: "Feature: Start",
    rawInput: "Add interactive command",
    source: "cli",
    repoPath: "/tmp/repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-03T19:00:00.000Z",
  },
  candidateFiles: ["apps/cli/src/index.ts"],
  requestedAt: "2026-05-03T19:00:00.000Z",
  policy,
};

function researchReport() {
  return {
    schemaVersion: "1",
    runId: researchInput.runId,
    initiativeId: researchInput.initiative.id,
    relevantFiles: [{ path: "apps/cli/src/index.ts", reason: "CLI command entrypoint" }],
    symbolsOfInterest: [{ name: "program", kind: "constant", filePath: "apps/cli/src/index.ts" }],
    openQuestions: [],
    summary: "CLI entrypoint is relevant.",
    generatedAt: researchInput.requestedAt,
  };
}

class FakeCodexRunner implements CodexCliRunner {
  readonly invocations: CodexCliInvocation[] = [];

  constructor(private readonly output: unknown) {}

  async run(invocation: CodexCliInvocation): Promise<CodexCliResult> {
    this.invocations.push(invocation);
    const parsed = [
      {
        type: "item.completed",
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: JSON.stringify(this.output) }],
        },
      },
      { type: "turn.completed", usage: { inputTokens: 23, outputTokens: 8 } },
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

class FakeCursorRunner implements CursorAgentCliRunner {
  readonly invocations: CursorAgentCliInvocation[] = [];

  constructor(private readonly output: unknown) {}

  async run(invocation: CursorAgentCliInvocation): Promise<CursorAgentCliResult> {
    this.invocations.push(invocation);
    const parsed = {
      result: JSON.stringify(this.output),
      usage: { input_tokens: 19, output_tokens: 7 },
      total_cost_usd: 0.04,
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

class FakeClaudeRunner implements ClaudeCodeCliRunner {
  readonly invocations: ClaudeCodeCliInvocation[] = [];

  constructor(private readonly output: unknown) {}

  async run(invocation: ClaudeCodeCliInvocation): Promise<ClaudeCodeCliResult> {
    this.invocations.push(invocation);
    const parsed = {
      type: "result",
      result: JSON.stringify(this.output),
      usage: { input_tokens: 29, output_tokens: 11 },
      total_cost_usd: 0.06,
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

describe("CLI reviewer providers", () => {
  it("reviews through claude-code-cli with explicit ReviewVerdict JSON schema", async () => {
    const runner = new FakeClaudeRunner(reviewVerdict);
    const provider = new ClaudeCodeCliReviewerProvider({ runner, env: { PATH: "/bin" }, policy });

    const output = await runReviewerProviderWithRetries(provider, reviewInput);

    expect(output.providerName).toBe("claude-code-cli:default");
    expect(output.reviewVerdict.verdict).toBe("pass");
    expect(output.cost.estimatedUsd).toBe(0.06);
    expect(runner.invocations[0]?.outputFormat).toBe("json");
    expect(runner.invocations[0]?.systemPrompt).toContain("ReviewVerdict JSON schema");
    expect(runner.invocations[0]?.systemPrompt).toContain("raw JSON ReviewVerdict");
  });

  it("reviews through codex-cli with auto-review approvals", async () => {
    const runner = new FakeCodexRunner(reviewVerdict);
    const provider = new CodexCliReviewerProvider({
      runner,
      env: { PATH: "/bin", SECRET_TOKEN: "hidden" },
      policy,
    });

    const output = await runReviewerProviderWithRetries(provider, reviewInput);

    expect(output.providerName).toBe("codex-cli:default");
    expect(output.reviewVerdict.verdict).toBe("pass");
    expect(output.modelUsage).toEqual({ inputTokens: 23, outputTokens: 8 });
    expect(runner.invocations[0]?.sandbox).toBe("workspace-write");
    expect(runner.invocations[0]?.approvalPolicy).toBe("on-request");
    expect(runner.invocations[0]?.approvalsReviewer).toBe("auto_review");
    expect(runner.invocations[0]?.prompt).toContain("ReviewVerdict JSON schema");
    expect(runner.invocations[0]?.env?.SECRET_TOKEN).toBeUndefined();
  });

  it("reviews through cursor-agent JSON output", async () => {
    const runner = new FakeCursorRunner(reviewVerdict);
    const provider = new CursorAgentReviewerProvider({ runner, env: { PATH: "/bin" }, policy });

    const output = await runReviewerProviderWithRetries(provider, reviewInput);

    expect(output.providerName).toBe("cursor-agent-cli:default");
    expect(output.reviewVerdict.safeToContinue).toBe(true);
    expect(output.cost.estimatedUsd).toBe(0.04);
    expect(runner.invocations[0]?.outputFormat).toBe("json");
  });
});

describe("CLI researcher providers", () => {
  it("researches through codex-cli with auto-review approvals", async () => {
    const runner = new FakeCodexRunner(researchReport());
    const provider = new CodexCliResearcherProvider({ runner, env: { PATH: "/bin", SECRET_TOKEN: "hidden" } });

    const output = await runResearcherProviderWithRetries(provider, researchInput);

    expect(output.providerName).toBe("codex-cli:default");
    expect(output.researchReport.relevantFiles[0]?.path).toBe("apps/cli/src/index.ts");
    expect(runner.invocations[0]?.sandbox).toBe("workspace-write");
    expect(runner.invocations[0]?.approvalPolicy).toBe("on-request");
    expect(runner.invocations[0]?.approvalsReviewer).toBe("auto_review");
    expect(runner.invocations[0]?.prompt).toContain("ResearchReport JSON schema");
    expect(runner.invocations[0]?.env?.SECRET_TOKEN).toBeUndefined();
  });

  it("researches through cursor-agent JSON output", async () => {
    const runner = new FakeCursorRunner(researchReport());
    const provider = new CursorAgentResearcherProvider({ runner, env: { PATH: "/bin" } });

    const output = await runResearcherProviderWithRetries(provider, researchInput);

    expect(output.providerName).toBe("cursor-agent-cli:default");
    expect(output.researchReport.symbolsOfInterest[0]?.name).toBe("program");
    expect(output.cost.estimatedUsd).toBe(0.04);
    expect(runner.invocations[0]?.outputFormat).toBe("json");
  });
});
