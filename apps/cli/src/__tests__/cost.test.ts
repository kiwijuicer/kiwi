import { existsSync, mkdtempSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { appendModelInvocation } from "@kiwi/core";
import { runCost } from "../commands/cost";
import { runInit } from "../commands/init";
import { runPlan } from "../commands/plan";

const NOW = new Date("2026-05-04T12:00:00.000Z");
const RUN_ID = "run_20260504_140000_cost";

async function setupRun(cwd: string): Promise<void> {
  await runInit({}, cwd);
  await runPlan(
    "# Cost Report\n\n## Implement",
    {
      allowStub: true,
      env: { PATH: "/empty" },
      now: NOW,
      runIdSuffix: "cost",
      initiativeIdSuffix: "cost",
      planIdSuffix: "cost",
    },
    cwd,
  );
}

describe("cost command", () => {
  it("prints a warning when unknown usage precision dominates", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-cost-warning-"));
    await setupRun(cwd);
    appendModelInvocation(cwd, {
      schemaVersion: "1",
      runId: RUN_ID,
      phase: "executor",
      stepId: "step_001",
      attemptId: "attempt_001",
      agentRole: "executor",
      requestedCapability: "strong",
      selectedCapability: "strong",
      modelId: "stub-executor",
      providerName: "stub",
      runner: "local-shell",
      usage: { inputTokens: 0, outputTokens: 0 },
      usagePrecision: "unknown",
      estimatedCostUsd: null,
      status: "blocked",
      evidenceRefs: [],
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
    });

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runCost(RUN_ID, {}, cwd);
    const output = spy.mock.calls.flat().join("\n");
    spy.mockRestore();

    expect(output).toContain("cost_precision_unknown_dominant");
  });

  it("writes final-cost-report.csv with one row per invocation", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-cost-csv-"));
    await setupRun(cwd);
    appendModelInvocation(cwd, {
      schemaVersion: "1",
      runId: RUN_ID,
      phase: "executor",
      stepId: "step_001",
      attemptId: "attempt_001",
      agentRole: "executor",
      requestedCapability: "strong",
      selectedCapability: "strong",
      modelId: "stub-executor",
      providerName: "stub",
      runner: "local-shell",
      usage: { inputTokens: 5, outputTokens: 2 },
      usagePrecision: "estimated",
      estimatedCostUsd: 0.02,
      status: "completed",
      evidenceRefs: [],
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
    });

    await runCost(RUN_ID, { csv: true }, cwd);
    const csvPath = path.join(cwd, ".kiwi", "runs", RUN_ID, "final", "final-cost-report.csv");
    expect(existsSync(csvPath)).toBe(true);
    const csv = readFileSync(csvPath, "utf-8").trim().split("\n");
    expect(csv[0]).toBe(
      "phase,stepId,attemptId,modelId,providerName,accessMode,inputTokens,outputTokens,usagePrecision,estimatedCostUsd",
    );
    expect(csv.length).toBe(3);
  });
});
