import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { SandboxCommandPolicy } from "@kiwi/sandbox";
import { buildCodexCliArgs, CodexCliInvocation, CodexCliResult, CodexCliRunner } from "../../integrations/codex/client";
import { CodexCliRunnerAdapter } from "../../integrations/codex/runner-adapter";
import { CursorAgentRunnerAdapter } from "../../integrations/cursor-agent/runner-adapter";
import {
  CursorAgentCliInvocation,
  CursorAgentCliResult,
  CursorAgentCliRunner,
} from "../../integrations/cursor-agent/client";
import { buildRunnerEnv } from "../../runners/env";
import { LocalShellRunnerAdapter } from "../../runners/local-shell";
import { StubExternalRunnerAdapter } from "../../runners/stub-external";

const nodeBin = process.execPath;

function cwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-runner-adapter-"));
}

class FakeCursorRunner implements CursorAgentCliRunner {
  readonly invocations: CursorAgentCliInvocation[] = [];

  async run(invocation: CursorAgentCliInvocation): Promise<CursorAgentCliResult> {
    this.invocations.push(invocation);
    mkdirSync(invocation.cwd, { recursive: true });
    writeFileSync(path.join(invocation.cwd, "generated.txt"), "from cursor\n", "utf-8");
    const stdout = JSON.stringify({
      usage: { input_tokens: 11, output_tokens: 7 },
      total_cost_usd: 0.123,
    });

    return {
      ok: true,
      exitCode: 0,
      stdout,
      stderr: "",
      parsed: JSON.parse(stdout),
      durationMs: 10,
      startedAt: "2026-05-04T12:00:00.000Z",
      completedAt: "2026-05-04T12:00:00.010Z",
      binary: invocation.binary,
      args: ["-p", invocation.prompt, "--output-format", "json"],
      timedOut: false,
    };
  }
}

class FakeCodexRunner implements CodexCliRunner {
  readonly invocations: CodexCliInvocation[] = [];

  async run(invocation: CodexCliInvocation): Promise<CodexCliResult> {
    this.invocations.push(invocation);
    mkdirSync(invocation.cwd, { recursive: true });
    writeFileSync(path.join(invocation.cwd, "generated-codex.txt"), "from codex\n", "utf-8");
    const parsed = [{ type: "turn.completed", usage: { inputTokens: 13, outputTokens: 5 } }];

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

function policy(overrides: Partial<SandboxCommandPolicy> = {}): SandboxCommandPolicy {
  return {
    allowedCommands: [nodeBin],
    approvalState: "auto",
    approvalRequiredPaths: [],
    deniedPaths: ["secrets/**"],
    envAllowlist: ["PATH"],
    secretValues: [],
    networkPolicy: "disabled",
    timeoutMs: 1000,
    maxOutputBytes: 4096,
    ...overrides,
  };
}

function step(title: string) {
  return {
    stepId: "step_001" as const,
    type: "coding" as const,
    title,
    successCriteria: ["done"],
    requiredGates: [],
  };
}

function contextPackage(runId: string, attemptId: string, title: string) {
  return {
    runId,
    stepId: "step_001" as const,
    attemptId,
    level: "L1" as const,
    initiative: {
      title: "Demo",
      rawInput: "Demo",
      riskProfile: "dev",
      budgetProfile: "normal",
    },
    task: {
      stepId: "step_001" as const,
      type: "coding" as const,
      title,
      successCriteria: ["done"],
      requiredGates: [],
      acceptanceCriteria: ["done"],
    },
    mutationRequirement: "must_change_files" as const,
    files: [],
    commands: { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
    budget: {
      modelCapability: "strong" as const,
      contextLevel: "L1" as const,
      selectedModelId: null,
      selectedProviderModel: null,
      estimatedAttemptCostUsd: null,
    },
    include: {
      initiative: true,
      policy: true,
      registry: true,
      commands: true,
      relevantFiles: [],
      tests: [],
      recentDiffFiles: [],
      symbolHits: [],
      traces: [],
      architectureFiles: [],
      historicalOutcomeRefs: [],
    },
    generatedAt: "2026-05-04T12:00:00.000Z",
  };
}

describe("runner adapters", () => {
  it("builds codex exec args with auto-review approvals by default", () => {
    const args = buildCodexCliArgs({
      binary: "codex",
      cwd: "/tmp/repo",
      prompt: "do it",
      timeoutMs: 1000,
    });

    expect(args).toContain("--sandbox");
    expect(args).toContain("workspace-write");
    expect(args).toContain('approval_policy="on-request"');
    expect(args).toContain('approvals_reviewer="auto_review"');
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("executes local-shell commands through the sandbox", async () => {
    const repo = cwd();
    const worktreePath = path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_001");
    const adapter = new LocalShellRunnerAdapter();

    const output = await adapter.execute({
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
      workspacePath: repo,
      worktreePath,
      step: step("Create a sample file"),
      contextPackage: contextPackage("run_demo", "attempt_001", "Create a sample file"),
      allowedTools: ["shell"],
      timeouts: { commandTimeoutMs: 1000 },
      command: [nodeBin, "-e", "require('fs').writeFileSync('sample.txt', 'ok'); console.log('done')"],
      commandPolicy: policy(),
      env: { PATH: process.env.PATH ?? "" },
    });

    expect(output.status).toBe("completed");
    expect(output.gateResult.status).toBe("pass");
    expect(output.rawLogsRef).toBe("steps/step_001/attempt_001/artifacts/command-output.json");
    expect(existsSync(path.join(worktreePath, "sample.txt"))).toBe(true);
    expect(existsSync(path.join(repo, "sample.txt"))).toBe(false);
  });

  it("returns structured blocked output when local-shell policy is missing", async () => {
    const repo = cwd();
    const adapter = new LocalShellRunnerAdapter();

    const output = await adapter.execute({
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_002",
      workspacePath: repo,
      worktreePath: path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_002"),
      step: step("Run command"),
      contextPackage: contextPackage("run_demo", "attempt_002", "Run command"),
      allowedTools: ["shell"],
      timeouts: { commandTimeoutMs: 1000 },
      command: [nodeBin, "-e", "console.log('ok')"],
    });

    expect(output.status).toBe("blocked");
    expect(output.error?.code).toBe("MISSING_COMMAND_POLICY");
    expect(output.gateResult.status).toBe("blocked");
  });

  it("returns structured failures for unconfigured external runners", async () => {
    const adapter = new StubExternalRunnerAdapter("codex");
    const output = await adapter.execute({
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_003",
      workspacePath: cwd(),
      worktreePath: "/tmp/unused",
      step: step("Run external model"),
      contextPackage: contextPackage("run_demo", "attempt_003", "Run external model"),
      allowedTools: [],
      timeouts: { commandTimeoutMs: 1000 },
    });

    expect(output.status).toBe("failed");
    expect(output.error?.code).toBe("RUNNER_NOT_IMPLEMENTED");
    expect(output.gateResult.status).toBe("fail");
  });

  it("filters runner env to safe keys and policy allowlist", () => {
    const env = buildRunnerEnv({
      sourceEnv: {
        PATH: "/bin",
        HOME: "/home/test",
        CI: "1",
        SECRET_TOKEN: "do-not-leak",
        CUSTOM_ALLOWED: "ok",
      },
      policy: { envAllowlist: ["CUSTOM_ALLOWED"] },
    });

    expect(env).toMatchObject({ PATH: "/bin", HOME: "/home/test", CI: "1", CUSTOM_ALLOWED: "ok" });
    expect(env.SECRET_TOKEN).toBeUndefined();
  });

  it("executes cursor-agent through a filtered env, captures logs, usage, and diff", async () => {
    const repo = cwd();
    writeFileSync(path.join(repo, "source.txt"), "source\n", "utf-8");
    const worktreePath = path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_cursor");
    const runner = new FakeCursorRunner();
    const adapter = new CursorAgentRunnerAdapter({
      binary: "cursor-agent",
      model: "cursor-agent-auto",
      cliRunner: runner,
      env: {
        PATH: "/bin",
        HOME: "/home/test",
        SECRET_TOKEN: "do-not-leak",
      },
    });

    const output = await adapter.execute({
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_cursor",
      workspacePath: repo,
      repoPath: repo,
      worktreePath,
      step: step("Generate a file"),
      contextPackage: contextPackage("run_demo", "attempt_cursor", "Generate a file"),
      allowedTools: ["shell"],
      timeouts: { commandTimeoutMs: 1000 },
      commandPolicy: policy({ envAllowlist: ["PATH"] }),
    });

    expect(output.status).toBe("completed");
    expect(output.providerName).toBe("cursor-agent-cli");
    expect(output.usagePrecision).toBe("exact");
    expect(output.estimatedCostUsd).toBe(0.123);
    expect(output.rawLogsRef).toBe("steps/step_001/attempt_cursor/artifacts/cursor-agent-runner-logs.json");
    expect(output.artifactRefs.some((artifact) => artifact.type === "diff")).toBe(true);
    expect(runner.invocations[0]?.env?.SECRET_TOKEN).toBeUndefined();
    const logs = readFileSync(path.join(repo, ".kiwi", "runs", "run_demo", output.rawLogsRef!), "utf-8");
    expect(logs).toContain("total_cost_usd");
  });

  it("executes codex through a filtered env, captures logs, estimated usage, and diff", async () => {
    const repo = cwd();
    writeFileSync(path.join(repo, "source.txt"), "source\n", "utf-8");
    const worktreePath = path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_codex");
    const runner = new FakeCodexRunner();
    const adapter = new CodexCliRunnerAdapter({
      binary: "codex",
      model: "gpt-5.4",
      cliRunner: runner,
      env: {
        PATH: "/bin",
        HOME: "/home/test",
        SECRET_TOKEN: "do-not-leak",
      },
    });

    const output = await adapter.execute({
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_codex",
      workspacePath: repo,
      repoPath: repo,
      worktreePath,
      step: step("Generate a file"),
      contextPackage: contextPackage("run_demo", "attempt_codex", "Generate a file"),
      allowedTools: ["shell"],
      timeouts: { commandTimeoutMs: 1000 },
      commandPolicy: policy({ envAllowlist: ["PATH"] }),
    });

    expect(output.status).toBe("completed");
    expect(output.providerName).toBe("codex-cli");
    expect(output.usagePrecision).toBe("estimated");
    expect(output.estimatedCostUsd).toBeNull();
    expect(output.artifactRefs.some((artifact) => artifact.type === "diff")).toBe(true);
    expect(runner.invocations[0]?.env?.SECRET_TOKEN).toBeUndefined();
    expect(runner.invocations[0]?.model).toBe("gpt-5.4");
    expect(runner.invocations[0]?.sandbox).toBe("workspace-write");
    expect(runner.invocations[0]?.approvalPolicy).toBe("on-request");
    expect(runner.invocations[0]?.approvalsReviewer).toBe("auto_review");
    expect(runner.invocations[0]?.prompt).toContain("doNotPush");
  });
});
