import { existsSync, mkdtempSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  appendModelInvocation,
  buildFinalCostReportFromModelInvocations,
  readModelInvocations,
  writeModelUsageSummary,
} from "../../ledger/model-invocations";

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
      usagePrecision: "exact",
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

  it("builds final cost reports from model invocations by phase and precision", () => {
    const repo = cwd();
    appendModelInvocation(repo, {
      schemaVersion: "1",
      runId: "run_demo",
      phase: "executor",
      stepId: "step_001",
      attemptId: "attempt_001",
      agentRole: "executor",
      requestedCapability: "strong",
      selectedCapability: "strong",
      modelId: "codex-cli-strong",
      providerName: "local",
      runner: "codex",
      accessMode: "codex-cli",
      usage: { inputTokens: 1, outputTokens: 2 },
      usagePrecision: "exact",
      estimatedCostUsd: 0.2,
      status: "completed",
      evidenceRefs: ["steps/step_001/attempt_001/artifacts/diff.patch"],
      startedAt: "2026-05-04T08:00:00.000Z",
      completedAt: "2026-05-04T08:00:01.000Z",
    });
    appendModelInvocation(repo, {
      schemaVersion: "1",
      runId: "run_demo",
      phase: "reviewer",
      stepId: "step_001",
      attemptId: "attempt_001",
      agentRole: "reviewer",
      requestedCapability: "frontier",
      selectedCapability: "frontier",
      modelId: "claude-code-cli-opus",
      providerName: "anthropic",
      runner: null,
      accessMode: "claude-code-cli",
      usage: { inputTokens: 3, outputTokens: 4 },
      usagePrecision: "estimated",
      estimatedCostUsd: 0.3,
      status: "completed",
      evidenceRefs: ["steps/step_001/attempt_001/artifacts/review-report.json"],
      startedAt: "2026-05-04T08:00:01.000Z",
      completedAt: "2026-05-04T08:00:02.000Z",
    });

    const report = buildFinalCostReportFromModelInvocations({
      cwd: repo,
      runId: "run_demo",
      now: new Date("2026-05-04T08:00:03.000Z"),
    });

    expect(report.executorCostUsd).toBe(0.2);
    expect(report.reviewerCostUsd).toBe(0.3);
    expect(report.totalEstimatedUsd).toBe(0.5);
    expect(report.usagePrecision).toEqual({ exact: 1, estimated: 1, unknown: 0 });
    expect(report.models.map((entry) => entry.accessMode)).toEqual(["codex-cli", "claude-code-cli"]);
  });
});
