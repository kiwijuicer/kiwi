import { existsSync, mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { BudgetProfile } from "@kiwi/contracts";
import { appendAuditEvent, loadPlannerCostReport, readAuditEvents, writePlannerCostReport } from "../cost-ledger";

describe("cost ledger", () => {
  it("appends and reads audit events", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cost-ledger-audit-"));

    appendAuditEvent(cwd, {
      eventType: "planner_provider_selected",
      runId: "run_demo_1",
      timestamp: "2026-05-04T05:00:00.000Z",
      payload: { plannerModelId: "stub-frontier" },
    });
    appendAuditEvent(cwd, {
      eventType: "planner_succeeded",
      runId: "run_demo_1",
      timestamp: "2026-05-04T05:00:01.000Z",
      payload: { attemptsUsed: 1 },
    });
    appendAuditEvent(cwd, {
      eventType: "planner_failed",
      runId: "run_demo_2",
      timestamp: "2026-05-04T05:00:02.000Z",
      payload: { reason: "validation" },
    });

    const all = readAuditEvents(cwd);
    const one = readAuditEvents(cwd, "run_demo_1");

    expect(all).toHaveLength(3);
    expect(one).toHaveLength(2);
    expect(one[0]?.eventType).toBe("planner_provider_selected");
  });

  it("writes and loads planner cost report", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cost-ledger-report-"));
    const runId = "run_demo_1";
    const budgetProfile: BudgetProfile = "normal";

    writePlannerCostReport(cwd, runId, {
      schemaVersion: "1",
      runId,
      plannerModelId: "stub-frontier",
      providerName: "stub-deterministic",
      budgetProfile,
      budgetRemainingUsdEstimate: null,
      attemptsUsed: 1,
      invalidAttempts: 0,
      modelUsage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      cost: {
        estimatedUsd: 0,
        currency: "USD",
      },
      createdAt: "2026-05-04T05:00:00.000Z",
    });

    const target = path.join(cwd, ".kiwi", "runs", runId, "plan", "cost-report.json");
    expect(existsSync(target)).toBe(true);

    const loaded = loadPlannerCostReport(cwd, runId);
    expect(loaded.providerName).toBe("stub-deterministic");
    expect(loaded.cost.estimatedUsd).toBe(0);
    expect(loaded.budgetRemainingUsdEstimate).toBe(null);
  });
});
