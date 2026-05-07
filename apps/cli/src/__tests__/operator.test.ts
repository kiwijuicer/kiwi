import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { kiwiPolicyPath, readAuditEvents } from "@kiwi/core";
import { runAttempt } from "../commands/attempt";
import { runCost } from "../commands/cost";
import { runEvidenceManifest } from "../commands/evidence";
import { runExplain } from "../commands/explain";
import { runFinalize } from "../commands/finalize";
import { runInit } from "../commands/init";
import { runOperatorSnapshot } from "../commands/operator";
import { runPlan } from "../commands/plan";
import { runRulesSync } from "../commands/rules";
import { runStatus } from "../commands/status";

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

describe("kiwi operator flow", () => {
  it("plans, attempts, finalizes, and reports gate/review evidence", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-operator-"));
    await runInit({}, cwd);
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
    await runStatus(cwd, "run_20260504_110000_op01");
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
      requestedCapability: "strong",
      selectedCapability: "strong",
      reason: "stub_fallback",
    });
  });

  it("blocks direct attempts when dependencies are incomplete and releases the run lock", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-dependencies-"));
    await runInit({}, cwd);
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
  });

  it("copies only the selected repo into a workspace attempt sandbox", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-workspace-attempt-"));
    const core = path.join(workspace, "voice-core");
    const agent = path.join(workspace, "voice-livekit-agent");
    mkdirSync(core);
    mkdirSync(agent);
    writeFileSync(path.join(core, "core.txt"), "core\n", "utf-8");
    writeFileSync(path.join(agent, "agent.txt"), "agent\n", "utf-8");
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
  });

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
