import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { KiwiPolicy } from "@kiwi/contracts";
import {
  createGateResult,
  evaluateForbiddenFiles,
  loadGateResults,
  saveGateResults,
  summarizeGateResults,
} from "../../gates/quality-gates.js";

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

  it("requires exact file approval for approval-required diff paths", () => {
    const policy: KiwiPolicy = {
      version: "1",
      project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
      commands: { test: "node -e 0", lint: "node -e 0", typecheck: "node -e 0" },
      routing: {
        defaultAgentRole: "executor",
        defaultModelCapability: "mid",
        providerPreference: {},
        stepTypeOverrides: {},
      },
      riskZones: { high: ["src/auth/**"] },
      approvals: { requireFor: [], commandApprovalStates: {} },
      commandProfiles: {
        default: {
          allowedCommands: ["node"],
          approvalState: "auto",
          approvalRequiredPaths: [],
          deniedPaths: [],
          envAllowlist: ["PATH"],
          secretEnvNames: [],
          networkPolicy: "disabled",
          timeoutMs: 1000,
          maxOutputBytes: 4096,
        },
        coding: {
          allowedCommands: ["node"],
          approvalState: "auto",
          approvalRequiredPaths: [],
          deniedPaths: [],
          envAllowlist: ["PATH"],
          secretEnvNames: [],
          networkPolicy: "disabled",
          timeoutMs: 1000,
          maxOutputBytes: 4096,
        },
      },
    };
    const diff =
      "diff --git a/src/auth/a.ts b/src/auth/a.ts\n--- a/src/auth/a.ts\n+++ b/src/auth/a.ts\n@@ -0,0 +1 @@\n+x\n";

    expect(evaluateForbiddenFiles({ diff, diffHash: "hash", policy }).status).toBe("blocked");
    expect(
      evaluateForbiddenFiles({
        diff,
        diffHash: "hash",
        policy,
        approvedFiles: ["src/auth/a.ts"],
      }).status,
    ).toBe("pass");
    expect(
      evaluateForbiddenFiles({
        diff,
        diffHash: "hash",
        policy,
        approvedFiles: ["src/auth/a.ts", "src/auth/b.ts"],
      }).status,
    ).toBe("blocked");
  });
});
