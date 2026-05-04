import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { ReviewVerdictSchema } from "@ai-kiwi/contracts";
import { createGateResult } from "../quality-gates";
import {
  StubReviewEngine,
  classifyReviewAction,
  loadReviewVerdict,
  saveReviewVerdict,
} from "../review-engine";

describe("review engine", () => {
  it("returns pass verdict when all required gates pass", async () => {
    const reviewEngine = new StubReviewEngine();
    const verdict = await reviewEngine.review({
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
      gateResults: [
        createGateResult({
          gateType: "typecheck",
          status: "pass",
          evidenceRefs: ["artifacts/typecheck-report.json"],
          reason: "No type errors",
        }),
      ],
    });

    expect(verdict.verdict).toBe("pass");
    expect(verdict.safeToContinue).toBe(true);
    expect(classifyReviewAction(verdict)).toBe("continue");
    expect(() => ReviewVerdictSchema.parse(verdict)).not.toThrow();
  });

  it("returns needs_changes for failed gates and reject for blocked gates", async () => {
    const reviewEngine = new StubReviewEngine();

    const failVerdict = await reviewEngine.review({
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
      gateResults: [
        createGateResult({
          gateType: "lint",
          status: "fail",
          evidenceRefs: ["artifacts/lint-report.json"],
          reason: "Lint failed",
        }),
      ],
    });
    expect(failVerdict.verdict).toBe("needs_changes");
    expect(failVerdict.safeToContinue).toBe(false);
    expect(classifyReviewAction(failVerdict)).toBe("fix_step");

    const blockedVerdict = await reviewEngine.review({
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
      gateResults: [
        createGateResult({
          gateType: "secrets_check",
          status: "blocked",
          evidenceRefs: ["artifacts/secrets-check.json"],
          reason: "Scanner unavailable",
        }),
      ],
    });
    expect(blockedVerdict.verdict).toBe("reject");
    expect(blockedVerdict.safeToContinue).toBe(false);
    expect(classifyReviewAction(blockedVerdict)).toBe("replan");
  });

  it("persists and loads structured review verdict JSON", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-review-engine-"));
    const verdict = ReviewVerdictSchema.parse({
      verdict: "pass_with_comments",
      safeToContinue: true,
      issues: [
        {
          code: "NIT-001",
          title: "Minor cleanup",
          severity: "low",
        },
      ],
      recommendedNextSteps: ["Continue"],
      confidence: 0.9,
    });

    const relativePath = saveReviewVerdict({
      cwd,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
      verdict,
    });
    expect(relativePath).toBe("steps/step_001/attempt_001/artifacts/review-report.json");

    const loaded = loadReviewVerdict({
      cwd,
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
    });
    expect(loaded).toEqual(verdict);
  });

  it("rejects invalid review payload", () => {
    expect(() =>
      ReviewVerdictSchema.parse({
        verdict: "pass",
        safeToContinue: true,
        issues: [],
        recommendedNextSteps: [],
        confidence: 2,
      }),
    ).toThrow();
  });
});
