import { ReviewerProviderInput } from "../../providers/reviewer.js";

const MAX_DIFF_BYTES = 200_000;

function trimDiff(diff: string): { diff: string; truncated: boolean } {
  if (Buffer.byteLength(diff, "utf-8") <= MAX_DIFF_BYTES) {
    return { diff, truncated: false };
  }
  const slice = Buffer.from(diff, "utf-8").subarray(0, MAX_DIFF_BYTES).toString("utf-8");

  return { diff: `${slice}\n[diff truncated to ${MAX_DIFF_BYTES} bytes]`, truncated: true };
}

export function buildReviewerUserEnvelope(input: ReviewerProviderInput): string {
  const trimmed = trimDiff(input.diff);

  return JSON.stringify(
    {
      request: "Review the focal step diff against the provided gate evidence.",
      runId: input.runId,
      stepId: input.stepId,
      attemptId: input.attemptId,
      requestedAt: input.requestedAt,
      step: {
        stepId: input.step.stepId,
        type: input.step.type,
        title: input.step.title,
        successCriteria: input.step.successCriteria,
        requiredGates: input.step.requiredGates,
      },
      diffHash: input.diffHash,
      diff: trimmed.diff,
      diffTruncated: trimmed.truncated,
      gateResults: input.gateResults,
    },
    null,
    2,
  );
}

export function buildReviewerRepairEnvelope(params: {
  input: ReviewerProviderInput;
  invalidAttempt: number;
  invalidOutput: unknown;
  validationError: string;
}): string {
  return JSON.stringify(
    {
      request: "Repair the previous ReviewVerdict so it validates against ReviewVerdictSchema.",
      runId: params.input.runId,
      stepId: params.input.stepId,
      attemptId: params.input.attemptId,
      requestedAt: params.input.requestedAt,
      diffHash: params.input.diffHash,
      invalidAttempt: params.invalidAttempt,
      validationError: params.validationError,
      invalidOutput: params.invalidOutput,
      constraints: [
        "Return only the corrected ReviewVerdict.",
        "Preserve valid intent from the original verdict.",
        "Do not add unrelated issues.",
      ],
    },
    null,
    2,
  );
}
