import { existsSync, mkdtempSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  captureWorktreeDiffArtifact,
  SandboxCommandPolicy,
  createWorktreeSandbox,
  executeSandboxCommand,
  readCommandOutputArtifact,
} from "../index";

const nodeBin = process.execPath;

function cwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-sandbox-"));
}

function policy(overrides: Partial<SandboxCommandPolicy> = {}): SandboxCommandPolicy {
  return {
    allowedCommands: [nodeBin],
    approvalState: "auto",
    approvalRequiredPaths: ["migrations/**"],
    deniedPaths: ["secrets/**"],
    envAllowlist: ["PATH", "KIWI_SECRET"],
    secretValues: ["s3cr3t"],
    networkPolicy: "disabled",
    timeoutMs: 500,
    maxOutputBytes: 4096,
    ...overrides,
  };
}

describe("worktree sandbox command execution", () => {
  it("runs allowed commands in isolated worktree and persists redacted output", async () => {
    const repo = cwd();
    const sandbox = createWorktreeSandbox({
      cwd: repo,
      runId: "run_demo",
      attemptId: "attempt_001",
    });

    const result = await executeSandboxCommand({
      cwd: repo,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
      worktreePath: sandbox.worktreePath,
      command: [nodeBin, "-e", "require('fs').writeFileSync('out.txt', 'ok'); console.log(process.env.KIWI_SECRET)"],
      env: {
        PATH: process.env.PATH ?? "",
        KIWI_SECRET: "s3cr3t",
      },
      policy: policy(),
    });

    expect(result.status).toBe("completed");
    expect(result.stdout).toContain("[REDACTED]");
    expect(result.stdout).not.toContain("s3cr3t");
    expect(existsSync(path.join(sandbox.worktreePath, "out.txt"))).toBe(true);
    expect(existsSync(path.join(repo, "out.txt"))).toBe(false);
    expect(result.artifactRefs[0]?.ref).toBe("steps/step_001/attempt_001/artifacts/command-output.json");

    const artifact = readCommandOutputArtifact({
      cwd: repo,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
    }) as { stdout: string };
    expect(artifact.stdout).not.toContain("s3cr3t");
  });

  it("blocks commands touching denied paths", async () => {
    const repo = cwd();
    const sandbox = createWorktreeSandbox({
      cwd: repo,
      runId: "run_demo",
      attemptId: "attempt_002",
    });

    const result = await executeSandboxCommand({
      cwd: repo,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_002",
      worktreePath: sandbox.worktreePath,
      command: [nodeBin, "secrets/key.txt"],
      policy: policy(),
    });

    expect(result.status).toBe("blocked");
    expect(result.gateResult.status).toBe("blocked");
    expect(result.stderr).toContain("denied path");
  });

  it("requires approval for approval-required paths", async () => {
    const repo = cwd();
    const sandbox = createWorktreeSandbox({
      cwd: repo,
      runId: "run_demo",
      attemptId: "attempt_003",
    });

    const result = await executeSandboxCommand({
      cwd: repo,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_003",
      worktreePath: sandbox.worktreePath,
      command: [nodeBin, "migrations/001.sql"],
      policy: policy(),
    });

    expect(result.status).toBe("approval_required");
    expect(result.gateResult.status).toBe("blocked");
    expect(result.stderr).toContain("approval");
  });

  it("requires explicit approval for git state changes", async () => {
    const repo = cwd();
    const sandbox = createWorktreeSandbox({
      cwd: repo,
      runId: "run_demo",
      attemptId: "attempt_git",
    });

    const result = await executeSandboxCommand({
      cwd: repo,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_git",
      worktreePath: sandbox.worktreePath,
      command: ["git", "-C", ".", "commit", "-m", "update"],
      policy: policy({ allowedCommands: ["git"] }),
    });

    expect(result.status).toBe("approval_required");
    expect(result.gateResult.status).toBe("blocked");
    expect(result.stderr).toContain("git state changes require explicit approval");
  });

  it("times out long-running commands and persists failure evidence", async () => {
    const repo = cwd();
    const sandbox = createWorktreeSandbox({
      cwd: repo,
      runId: "run_demo",
      attemptId: "attempt_004",
    });

    const result = await executeSandboxCommand({
      cwd: repo,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_004",
      worktreePath: sandbox.worktreePath,
      command: [nodeBin, "-e", "setTimeout(() => {}, 1000)"],
      env: { PATH: process.env.PATH ?? "" },
      policy: policy({ timeoutMs: 30 }),
    });

    expect(result.status).toBe("timeout");
    expect(result.gateResult.status).toBe("fail");
    expect(result.gateResult.evidenceRefs).toContain("steps/step_001/attempt_004/artifacts/command-output.json");
  });

  it("blocks network commands when network policy is disabled", async () => {
    const repo = cwd();
    const sandbox = createWorktreeSandbox({
      cwd: repo,
      runId: "run_demo",
      attemptId: "attempt_005",
    });

    const result = await executeSandboxCommand({
      cwd: repo,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_005",
      worktreePath: sandbox.worktreePath,
      command: [nodeBin, "https://example.com"],
      policy: policy(),
    });

    expect(result.status).toBe("blocked");
    expect(result.stderr).toContain("network access is disabled");
  });

  it("writes audit events for command decisions", async () => {
    const repo = cwd();
    const sandbox = createWorktreeSandbox({
      cwd: repo,
      runId: "run_demo",
      attemptId: "attempt_006",
    });

    await executeSandboxCommand({
      cwd: repo,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_006",
      worktreePath: sandbox.worktreePath,
      command: [nodeBin, "-e", "console.log('ok')"],
      env: { PATH: process.env.PATH ?? "" },
      policy: policy(),
    });

    const auditLog = readFileSync(path.join(repo, ".kiwi", "logs", "audit.log"), "utf-8");
    expect(auditLog).toContain("sandbox_command_allowed");
    expect(auditLog).toContain("sandbox_command_completed");
  });

  it("captures worktree diff artifacts without touching main workspace", async () => {
    const repo = cwd();
    const sandbox = createWorktreeSandbox({
      cwd: repo,
      runId: "run_demo",
      attemptId: "attempt_007",
    });

    await executeSandboxCommand({
      cwd: repo,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_007",
      worktreePath: sandbox.worktreePath,
      command: [nodeBin, "-e", "require('fs').writeFileSync('feature.txt', 'new')"],
      env: { PATH: process.env.PATH ?? "" },
      policy: policy(),
    });

    const artifact = captureWorktreeDiffArtifact({
      cwd: repo,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_007",
      worktreePath: sandbox.worktreePath,
    });
    expect(artifact?.type).toBe("diff");
    expect(existsSync(path.join(repo, "feature.txt"))).toBe(false);
    expect(
      existsSync(
        path.join(repo, ".kiwi", "runs", "run_demo", "steps", "step_001", "attempt_007", "artifacts", "diff.patch"),
      ),
    ).toBe(true);
  });
});
