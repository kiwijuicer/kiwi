import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { createGateResult, loadGateResults, saveGateResults, summarizeGateResults } from "../quality-gates";

describe("quality gates", () => {
  it("summarizes pass/fail/blocked results and blocks continuation on fail/blocked", () => {
    const pass = createGateResult({
      gateType: "typecheck",
      status: "pass",
      evidenceRefs: ["artifacts/typecheck-report.json"],
      reason: "No type errors",
    });
    const fail = createGateResult({
      gateType: "lint",
      status: "fail",
      evidenceRefs: ["artifacts/lint-report.json"],
      reason: "Lint violations",
    });
    const blocked = createGateResult({
      gateType: "secrets_check",
      status: "blocked",
      evidenceRefs: ["artifacts/secrets-check.json"],
      reason: "Secret scanner unavailable",
    });

    expect(summarizeGateResults([pass]).safeToContinue).toBe(true);
    expect(summarizeGateResults([pass, fail]).safeToContinue).toBe(false);
    expect(summarizeGateResults([pass, blocked]).overallStatus).toBe("blocked");
  });

  it("persists and loads gate results under step attempt", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-quality-gates-"));
    const gateResults = [
      createGateResult({
        gateType: "tests",
        status: "pass",
        evidenceRefs: ["artifacts/test-report.json"],
        reason: "Tests passed",
      }),
    ];

    const relativePath = saveGateResults({
      cwd,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
      gateResults,
    });

    expect(relativePath).toBe("steps/step_001/attempt_001/gate-results.json");
    const loaded = loadGateResults({
      cwd,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
    });
    expect(loaded).toEqual(gateResults);
  });
});
