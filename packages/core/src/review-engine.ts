import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { GateResult, ReviewVerdict, ReviewVerdictSchema } from "@kiwi/contracts";
import { summarizeGateResults } from "./quality-gates";
import { resolveRunArtifactPath } from "./run-store";

export type ReviewAction = "continue" | "fix_step" | "replan";

export interface ReviewInput {
  runId: string;
  stepId: string;
  attemptId: string;
  gateResults: GateResult[];
}

export interface ReviewEngine {
  readonly name: string;
  review(input: ReviewInput): Promise<ReviewVerdict>;
}

export class StubReviewEngine implements ReviewEngine {
  readonly name = "stub-review";

  async review(input: ReviewInput): Promise<ReviewVerdict> {
    const gateSummary = summarizeGateResults(input.gateResults);
    if (!gateSummary.safeToContinue) {
      return ReviewVerdictSchema.parse({
        verdict: gateSummary.overallStatus === "blocked" ? "reject" : "needs_changes",
        safeToContinue: false,
        issues: [
          {
            code: "GATE_FAILURE",
            title: "Required quality gates are not passing",
            severity: gateSummary.overallStatus === "blocked" ? "high" : "medium",
            detail: `Failing gates: ${gateSummary.failingGateIds.join(", ")} Blocked gates: ${gateSummary.blockedGateIds.join(", ")}`.trim(),
          },
        ],
        recommendedNextSteps: [
          gateSummary.overallStatus === "blocked"
            ? "Replan with policy-compliant steps"
            : "Create a fix step and re-run gates",
        ],
        confidence: 0.9,
      });
    }

    return ReviewVerdictSchema.parse({
      verdict: "pass",
      safeToContinue: true,
      issues: [],
      recommendedNextSteps: ["Continue to next step"],
      confidence: 0.95,
    });
  }
}

function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

export function classifyReviewAction(verdict: ReviewVerdict): ReviewAction {
  if (verdict.verdict === "reject") return "replan";
  if (verdict.verdict === "needs_changes") return "fix_step";
  return "continue";
}

export function saveReviewVerdict(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  verdict: ReviewVerdict;
}): string {
  const validated = ReviewVerdictSchema.parse(params.verdict);
  const relativePath = `steps/${params.stepId}/${params.attemptId}/artifacts/review-report.json`;
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  writeJsonSafely(target, validated);
  return relativePath;
}

export function loadReviewVerdict(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
}): ReviewVerdict {
  const relativePath = `steps/${params.stepId}/${params.attemptId}/artifacts/review-report.json`;
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  if (!existsSync(target)) {
    throw new Error(`review verdict not found: ${relativePath}`);
  }

  const parsed = JSON.parse(readFileSync(target, "utf-8")) as unknown;
  return ReviewVerdictSchema.parse(parsed);
}
