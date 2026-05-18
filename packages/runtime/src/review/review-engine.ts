import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import {
  ContractValues,
  AccessMode,
  GateResult,
  ModelCapability,
  ModelEntry,
  NextActionTypes,
  type NextActionType,
  ReviewVerdict,
  ReviewVerdictSchema,
  Step,
} from "@kiwi/contracts";
import { resolveRunArtifactPath, writeJsonSafely } from "@kiwi/core";
import { summarizeGateResults } from "../gates/quality-gates";

export type ReviewAction = NextActionType;

export interface ReviewInput {
  runId: string;
  stepId: string;
  attemptId: string;
  gateResults: GateResult[];
  step?: Step;
  diff?: string | null;
  diffHash?: string | null;
  riskHigh?: boolean;
}

export interface ReviewExecutionMetadata {
  modelId: string | null;
  providerName: string;
  accessMode?: AccessMode;
  selectedCapability?: ModelCapability;
  requestedCapability?: ModelCapability;
  modelUsage: { inputTokens: number; outputTokens: number };
  estimatedCostUsd: number;
  diffHash?: string | null;
  attemptsUsed?: number;
  invalidAttempts?: number;
}

export interface ReviewExecutionResult {
  verdict: ReviewVerdict;
  metadata: ReviewExecutionMetadata;
}

export interface ReviewEngine {
  readonly name: string;
  review(input: ReviewInput): Promise<ReviewVerdict>;
  reviewWithExecution?(input: ReviewInput): Promise<ReviewExecutionResult>;
}

export class StubReviewEngine implements ReviewEngine {
  readonly name = "stub-review";

  async review(input: ReviewInput): Promise<ReviewVerdict> {
    const gateSummary = summarizeGateResults(input.gateResults);

    if (!gateSummary.safeToContinue) {
      return ReviewVerdictSchema.parse({
        verdict:
          gateSummary.overallStatus === ContractValues.Blocked ? ContractValues.Reject : ContractValues.NeedsChanges,
        safeToContinue: false,
        issues: [
          {
            code: "GATE_FAILURE",
            title: "Required quality gates are not passing",
            severity: gateSummary.overallStatus === ContractValues.Blocked ? "high" : "medium",
            detail:
              `Failing gates: ${gateSummary.failingGateIds.join(", ")} Blocked gates: ${gateSummary.blockedGateIds.join(", ")}`.trim(),
          },
        ],
        recommendedNextSteps: [
          gateSummary.overallStatus === ContractValues.Blocked
            ? "Replan with policy-compliant steps"
            : "Create a fix step and re-run gates",
        ],
        confidence: 0.9,
        ...(input.diffHash ? { subject: { type: "diff", hash: input.diffHash } } : {}),
      });
    }

    return ReviewVerdictSchema.parse({
      verdict: ContractValues.Pass,
      safeToContinue: true,
      issues: [],
      recommendedNextSteps: ["Continue to next step"],
      confidence: 0.95,
      ...(input.diffHash ? { subject: { type: "diff", hash: input.diffHash } } : {}),
    });
  }

  async reviewWithExecution(input: ReviewInput): Promise<ReviewExecutionResult> {
    const verdict = await this.review(input);

    return {
      verdict,
      metadata: {
        modelId: "stub-reviewer",
        providerName: "stub",
        modelUsage: { inputTokens: 0, outputTokens: 0 },
        estimatedCostUsd: 0,
        diffHash: input.diffHash ?? null,
      },
    };
  }
}

export function classifyReviewAction(verdict: ReviewVerdict): ReviewAction {
  if (verdict.verdict === ContractValues.Reject) {
    return NextActionTypes.Replan;
  }
  if (verdict.verdict === ContractValues.NeedsChanges) {
    return NextActionTypes.FixStep;
  }

  return NextActionTypes.Continue;
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

export interface AttemptDiff {
  diff: string;
  diffHash: string;
  diffPath: string;
}

export function loadAttemptDiff(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
}): AttemptDiff | null {
  const relativePath = `steps/${params.stepId}/${params.attemptId}/artifacts/diff.patch`;
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);

  if (!existsSync(target)) {
    return null;
  }
  const diff = readFileSync(target, "utf-8");
  const diffHash = `sha256:${createHash("sha256").update(diff).digest("hex")}`;

  return { diff, diffHash, diffPath: relativePath };
}

export function selectReviewerModel(models: ModelEntry[], riskHigh: boolean): ModelEntry {
  const enabled = models.filter((model) => model.enabled && model.roles.includes(ContractValues.Reviewer));

  if (enabled.length === 0) {
    throw new Error("No enabled reviewer model found in .kiwi/model-registry.yaml");
  }
  const targetCapability = riskHigh ? ContractValues.Frontier : ContractValues.Strong;
  const exact = enabled.find((model) => model.capability === targetCapability);

  if (exact) {
    return exact;
  }
  const frontier = enabled.find((model) => model.capability === ContractValues.Frontier);

  if (frontier) {
    return frontier;
  }
  const strong = enabled.find((model) => model.capability === ContractValues.Strong);

  if (strong) {
    return strong;
  }

  return enabled[0]!;
}

export function persistReviewerProviderArtifacts(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  reviewerInput: unknown;
  reviewerOutput: unknown;
}): { reviewerInputRef: string; reviewerOutputRef: string } {
  const inputRel = `steps/${params.stepId}/${params.attemptId}/artifacts/reviewer-input.json`;
  const outputRel = `steps/${params.stepId}/${params.attemptId}/artifacts/reviewer-output.json`;
  const inputTarget = resolveRunArtifactPath(params.runId, inputRel, params.cwd);
  const outputTarget = resolveRunArtifactPath(params.runId, outputRel, params.cwd);
  writeJsonSafely(inputTarget, params.reviewerInput);
  writeJsonSafely(outputTarget, params.reviewerOutput);

  return { reviewerInputRef: inputRel, reviewerOutputRef: outputRel };
}
