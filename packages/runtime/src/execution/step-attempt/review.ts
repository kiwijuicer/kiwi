import { ContractValues, EvidenceSubject, GateResult, ModelCapability, ReviewVerdict, Step } from "@kiwi/contracts";
import {
  AttemptDiff,
  classifyReviewAction,
  ReviewEngine,
  ReviewExecutionMetadata,
  saveReviewVerdict,
  StubReviewEngine,
} from "../../review/review-engine";
import type { StepAttemptNextAction } from "../step-runner-types";
import { enforceGateResultsBeforePositiveReview } from "./gates";

export function nextActionFromReview(verdict: ReviewVerdict): StepAttemptNextAction {
  const action = classifyReviewAction(verdict);

  return {
    type: action,
    reason: verdict.verdict,
    recommendedNextSteps: verdict.recommendedNextSteps,
    issueCodes: verdict.issues.map((issue) => issue.code),
  };
}

export async function runAttemptReview(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  step: Step;
  gateResults: GateResult[];
  attemptDiff: AttemptDiff | null;
  diffSubject: EvidenceSubject | null;
  reviewDepth: ModelCapability;
  reviewEngine?: ReviewEngine;
  defaultReviewEngine?: ReviewEngine;
}): Promise<{
  reviewVerdict: ReviewVerdict;
  reviewReportRef: string;
  metadata: ReviewExecutionMetadata;
  startedAt: string;
}> {
  const reviewEngine = params.reviewEngine ?? params.defaultReviewEngine ?? new StubReviewEngine();
  const startedAt = new Date().toISOString();
  const reviewInput = {
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    gateResults: params.gateResults,
    step: params.step,
    diff: params.attemptDiff?.diff ?? null,
    diffHash: params.attemptDiff?.diffHash ?? null,
    requestedCapability: params.reviewDepth,
  };
  const richExecution = reviewEngine.reviewWithExecution ? await reviewEngine.reviewWithExecution(reviewInput) : null;
  const rawReviewVerdict = richExecution ? richExecution.verdict : await reviewEngine.review(reviewInput);
  const metadata: ReviewExecutionMetadata = richExecution?.metadata ?? {
    modelId: reviewEngine.name === "stub-review" ? "stub-reviewer" : reviewEngine.name,
    providerName: reviewEngine.name === "stub-review" ? "stub" : reviewEngine.name,
    modelUsage: { inputTokens: 0, outputTokens: 0 },
    estimatedCostUsd: 0,
    ...(params.attemptDiff ? { diffHash: params.attemptDiff.diffHash } : {}),
  };
  const reviewVerdict = enforceGateResultsBeforePositiveReview({
    gateResults: params.gateResults,
    reviewVerdict: rawReviewVerdict,
    ...(params.diffSubject ? { subject: params.diffSubject } : {}),
  });
  const reviewReportRef = saveReviewVerdict({
    cwd: params.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    verdict: reviewVerdict,
  });

  return { reviewVerdict, reviewReportRef, metadata, startedAt };
}
