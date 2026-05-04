import { existsSync, mkdtempSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  appendModelInvocation,
  readModelInvocations,
  writeModelUsageSummary,
} from "../model-invocations";

function cwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-model-invocations-"));
}

describe("model invocations", () => {
  it("persists invocation records and writes usage summaries", () => {
    const repo = cwd();
    appendModelInvocation(repo, {
      schemaVersion: "1",
      runId: "run_demo",
      phase: "planner",
      agentRole: "planner",
      requestedCapability: "frontier",
      selectedCapability: "frontier",
      modelId: "stub-frontier",
      providerName: "stub-deterministic",
      runner: null,
      usage: { inputTokens: 10, outputTokens: 20 },
      estimatedCostUsd: 0,
      status: "completed",
      evidenceRefs: ["plan/planner-output.json"],
      startedAt: "2026-05-04T08:00:00.000Z",
      completedAt: "2026-05-04T08:00:01.000Z",
    });

    const records = readModelInvocations(repo, "run_demo");
    expect(records).toHaveLength(1);
    expect(records[0]?.modelId).toBe("stub-frontier");

    const result = writeModelUsageSummary({
      cwd: repo,
      runId: "run_demo",
      now: new Date("2026-05-04T08:00:02.000Z"),
    });

    expect(result.summary.totals.inputTokens).toBe(10);
    expect(result.summary.byPhase.planner?.outputTokens).toBe(20);
    const target = path.join(repo, ".kiwi", "runs", "run_demo", "final", "model-usage-summary.json");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toContain("stub-frontier");
  });
});
