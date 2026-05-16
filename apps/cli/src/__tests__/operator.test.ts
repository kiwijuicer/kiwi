import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kiwiPolicyPath, readAuditEvents } from "@kiwi/core";
import { runAttempt } from "../commands/attempt";
import { runCost } from "../commands/cost";
import { runEvidenceManifest } from "../commands/evidence";
import { runExplain } from "../commands/explain";
import { runFinalize } from "../commands/finalize";
import { runInit } from "../commands/init";
import { runOperatorSnapshot } from "../commands/operator";
import { runPlan } from "../commands/plan";
import { runRun } from "../commands/run";
import { runRulesSync } from "../commands/rules";
import { runStatus } from "../commands/status";

let previousForceAccessMode: string | undefined;

function writeFastPolicy(cwd: string): void {
  writeFileSync(
    kiwiPolicyPath(cwd),
    `version: "1"
project:
  name: kiwi
  language: typescript
  packageManager: pnpm
commands:
  test: node -e 0
  lint: node -e 0
  typecheck: node -e 0
routing:
  defaultAgentRole: executor
  defaultModelCapability: mid
  stepTypeOverrides:
    validation:
      agentRole: reviewer
      modelCapability: strong
riskZones:
  high: []
approvals:
  requireFor: []
  commandApprovalStates: {}
commandProfiles:
  default:
    allowedCommands: [node]
    approvalState: auto
    approvalRequiredPaths: []
    deniedPaths: [.env*, secrets/**]
    envAllowlist: [PATH]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 1000
    maxOutputBytes: 4096
  validation:
    allowedCommands: [node]
    approvalState: auto
    approvalRequiredPaths: []
    deniedPaths: [.env*, secrets/**]
    envAllowlist: [PATH]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 1000
    maxOutputBytes: 4096
`,
    "utf-8",
  );
}

function initSafeGitRepo(cwd: string): void {
  writeFileSync(path.join(cwd, ".gitignore"), ".kiwi/\n", "utf-8");
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  execFileSync("git", ["checkout", "-b", "feature/test"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", ".gitignore"], { cwd, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=Kiwi", "-c", "user.email=kiwi@example.com", "commit", "-m", "initial"], {
    cwd,
    stdio: "ignore",
  });
}

describe("kiwi operator flow", () => {
  beforeEach(() => {
    previousForceAccessMode = process.env.KIWI_FORCE_ACCESS_MODE;
    process.env.KIWI_FORCE_ACCESS_MODE = "stub";
  });

  afterEach(() => {
    if (previousForceAccessMode === undefined) {
      delete process.env.KIWI_FORCE_ACCESS_MODE;
    } else {
      process.env.KIWI_FORCE_ACCESS_MODE = previousForceAccessMode;
    }
  });

  it("plans, attempts, finalizes, and reports gate/review evidence", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-operator-"));
    await runInit({}, cwd);
    initSafeGitRepo(cwd);
    writeFastPolicy(cwd);
    await runPlan(
      "# Feature: Operator\n\n## Validate",
      {
        allowStub: true,
        env: { PATH: "/empty" },
        now: new Date("2026-05-04T09:00:00.000Z"),
        runIdSuffix: "op01",
        initiativeIdSuffix: "op01",
        planIdSuffix: "op01",
      },
      cwd,
    );

    await runAttempt(
      "run_20260504_110000_op01",
      "step_001",
      {
        attemptId: "attempt_001",
        now: new Date("2026-05-04T09:01:00.000Z"),
      },
      cwd,
    );
    const finalizeSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runFinalize("run_20260504_110000_op01", { now: new Date("2026-05-04T09:02:00.000Z") }, cwd);
    const finalizeOutput = finalizeSpy.mock.calls.flat().join("\n");
    finalizeSpy.mockRestore();
    expect(finalizeOutput).toContain("cost: $0.00 estimated");
    expect(finalizeOutput).toContain("verdict: pass");
    await runEvidenceManifest("run_20260504_110000_op01", { now: new Date("2026-05-04T09:03:00.000Z") }, cwd);
    await runOperatorSnapshot("run_20260504_110000_op01", { now: new Date("2026-05-04T09:04:00.000Z") }, cwd);

    expect(
      existsSync(
        path.join(
          cwd,
          ".kiwi",
          "runs",
          "run_20260504_110000_op01",
          "steps",
          "step_001",
          "attempt_001",
          "gate-results.json",
        ),
      ),
    ).toBe(true);
    expect(
      readFileSync(path.join(cwd, ".kiwi", "runs", "run_20260504_110000_op01", "final", "final-summary.md"), "utf-8"),
    ).toContain("safeToApply: true");

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runStatus(cwd, "run_20260504_110000_op01", { verbose: true });
    const output = spy.mock.calls.flat().join("\n");
    spy.mockRestore();

    expect(output).toContain("attempts:");
    expect(output).toContain("step_001/attempt_001");
    expect(output).toContain("review:pass");
    expect(output).toContain("final/final-summary.md");
    expect(output).toContain("final/evidence-manifest.json");
    expect(output).toContain("operator/index.html");

    const costSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runCost("run_20260504_110000_op01", {}, cwd);
    const costOutput = costSpy.mock.calls.flat().join("\n");
    costSpy.mockRestore();
    expect(costOutput).toContain("planner:");
    expect(costOutput).toContain("executor:");
    expect(costOutput).toContain("reviewer:");

    const explainSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runExplain("run_20260504_110000_op01", {}, cwd);
    const explainOutput = explainSpy.mock.calls.flat().join("\n");
    explainSpy.mockRestore();
    expect(explainOutput).toContain("routing:");
    expect(explainOutput).toContain("executor:stub_fallback");
    expect(explainOutput).toContain("gates:");
    const executorEvent = readAuditEvents(cwd, "run_20260504_110000_op01").find(
      (event) => event.eventType === "executor_model_selected",
    );
    expect(executorEvent?.payload).toMatchObject({
      attemptId: "attempt_001",
      runner: "local-shell",
      requestedCapability: "strong",
      selectedCapability: "strong",
      accessMode: "stub",
      reason: "stub_fallback",
    });
  }, 10000);

  it("blocks direct attempts when dependencies are incomplete and releases the run lock", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-dependencies-"));
    await runInit({}, cwd);
    initSafeGitRepo(cwd);
    writeFastPolicy(cwd);
    await runPlan(
      "# Feature: Dependencies\n\n## First\n\n## Second",
      {
        allowStub: true,
        env: { PATH: "/empty" },
        now: new Date("2026-05-04T09:10:00.000Z"),
        runIdSuffix: "deps",
        initiativeIdSuffix: "deps",
        planIdSuffix: "deps",
      },
      cwd,
    );

    await expect(
      runAttempt(
        "run_20260504_111000_deps",
        "step_002",
        {
          attemptId: "attempt_002",
          now: new Date("2026-05-04T09:11:00.000Z"),
        },
        cwd,
      ),
    ).rejects.toThrow("Cannot execute step_002 before dependencies complete: step_001");

    expect(existsSync(path.join(cwd, ".kiwi", "runs", "run_20260504_111000_deps", "run.lock"))).toBe(false);

    await runAttempt(
      "run_20260504_111000_deps",
      "step_001",
      {
        attemptId: "attempt_001",
        now: new Date("2026-05-04T09:12:00.000Z"),
      },
      cwd,
    );
  }, 10000);

  it("writes safe progress while running planned steps", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-run-progress-"));
    await runInit({}, cwd);
    initSafeGitRepo(cwd);
    writeFastPolicy(cwd);
    await runPlan(
      "# Feature: Run Progress\n\n## Validate",
      {
        allowStub: true,
        env: { PATH: "/empty" },
        now: new Date("2026-05-04T12:00:00.000Z"),
        runIdSuffix: "r001",
        initiativeIdSuffix: "r001",
        planIdSuffix: "r001",
      },
      cwd,
    );
    const lines: string[] = [];

    await runRun(
      "run_20260504_140000_r001",
      {
        now: new Date("2026-05-04T12:01:00.000Z"),
        progress: {
          enabled: true,
          write: (line) => lines.push(line),
        },
      },
      cwd,
    );

    const output = lines.join("\n");
    expect(output).toContain("Running run...");
    expect(output).toContain("runId: run_20260504_140000_r001");
    expect(output).toContain("step step_001: Validate");
    expect(output).toContain("executing attempt and review...");
    expect(output).toContain("step step_001 done: status=completed next=continue runStatus=completed");
  }, 10000);

  it("edits only the selected repo directly by default", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-workspace-attempt-"));
    const core = path.join(workspace, "voice-core");
    const agent = path.join(workspace, "voice-livekit-agent");
    mkdirSync(core);
    mkdirSync(agent);
    writeFileSync(path.join(core, "core.txt"), "core\n", "utf-8");
    writeFileSync(path.join(agent, "agent.txt"), "agent\n", "utf-8");
    execFileSync("git", ["init"], { cwd: core, stdio: "ignore" });
    execFileSync("git", ["checkout", "-b", "feature/test"], { cwd: core, stdio: "ignore" });
    execFileSync("git", ["add", "core.txt"], { cwd: core, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=Kiwi", "-c", "user.email=kiwi@example.com", "commit", "-m", "initial"], {
      cwd: core,
      stdio: "ignore",
    });
    writeFileSync(
      path.join(workspace, "workspace.code-workspace"),
      JSON.stringify({
        folders: [
          { name: "voice-core", path: "voice-core" },
          { name: "voice-livekit-agent", path: "voice-livekit-agent" },
        ],
      }),
      "utf-8",
    );
    await runInit({}, workspace);
    writeFastPolicy(workspace);
    await runPlan(
      "# Feature: Workspace Attempt\n\n## Implement",
      {
        allowStub: true,
        env: { PATH: "/empty" },
        workspace,
        repo: "voice-core",
        now: new Date("2026-05-04T10:00:00.000Z"),
        runIdSuffix: "ws01",
        initiativeIdSuffix: "ws01",
        planIdSuffix: "ws01",
      },
      workspace,
    );

    await runAttempt(
      "run_20260504_120000_ws01",
      "step_001",
      {
        workspace,
        attemptId: "attempt_ws",
        command: "node -e require('fs').writeFileSync('changed.txt','ok')",
        now: new Date("2026-05-04T10:01:00.000Z"),
      },
      workspace,
    );

    const worktree = path.join(workspace, ".kiwi", "runs", "run_20260504_120000_ws01", "worktrees", "attempt_ws");
    expect(existsSync(worktree)).toBe(false);
    expect(existsSync(path.join(core, "changed.txt"))).toBe(true);
    expect(existsSync(path.join(agent, "changed.txt"))).toBe(false);
    const diff = path.join(
      workspace,
      ".kiwi",
      "runs",
      "run_20260504_120000_ws01",
      "steps",
      "step_001",
      "attempt_ws",
      "artifacts",
      "diff.patch",
    );
    expect(existsSync(diff)).toBe(true);
  }, 10000);

  it("syncs cursor rules from canonical sources", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-rules-"));
    writeFileSync(path.join(cwd, "AGENTS.md"), "# Agents\n", "utf-8");
    const rulesDir = path.join(cwd, "docs", "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(path.join(rulesDir, "project.md"), "# Project\n", "utf-8");

    await runRulesSync({ target: "cursor" }, cwd);

    expect(existsSync(path.join(cwd, ".cursor", "rules", "agents.mdc"))).toBe(true);
    expect(existsSync(path.join(cwd, ".cursor", "rules", "project.mdc"))).toBe(true);
  });
});
