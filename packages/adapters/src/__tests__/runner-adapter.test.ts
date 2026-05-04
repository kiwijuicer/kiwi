import { existsSync, mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { SandboxCommandPolicy } from "@kiwi/sandbox";
import { LocalShellRunnerAdapter } from "../local-shell-runner-adapter";
import { StubExternalRunnerAdapter } from "../stub-external-runner-adapter";

const nodeBin = process.execPath;

function cwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-runner-adapter-"));
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

describe("runner adapters", () => {
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
      stepPrompt: "Create a sample file",
      contextPackage: {},
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
      stepPrompt: "Run command",
      contextPackage: {},
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
      stepPrompt: "Run external model",
      contextPackage: {},
      allowedTools: [],
      timeouts: { commandTimeoutMs: 1000 },
    });

    expect(output.status).toBe("failed");
    expect(output.error?.code).toBe("RUNNER_NOT_IMPLEMENTED");
    expect(output.gateResult.status).toBe("fail");
  });
});
