import { GateResult, ReviewVerdict, ReviewVerdictSchema, Step } from "@kiwi/contracts";
import type { ProviderFailureCode, ProviderValidationStatus } from "../constants";

export interface ReviewerProviderInput {
  runId: string;
  stepId: string;
  attemptId: string;
  step: Pick<Step, "stepId" | "type" | "title" | "successCriteria" | "requiredGates">;
  diff: string;
  diffHash: string;
  gateResults: GateResult[];
  requestedAt: string;
}

export interface ReviewerModelUsageEstimate {
  inputTokens: number;
  outputTokens: number;
}

export interface ReviewerCostEstimate {
  estimatedUsd: number;
  currency: "USD";
}

export interface ReviewerProviderArtifacts {
  reviewerInput?: unknown;
  reviewerOutput?: unknown;
}

export interface ReviewerProviderOutput {
  providerName: string;
  reviewVerdict: unknown;
  modelUsage: ReviewerModelUsageEstimate;
  cost: ReviewerCostEstimate;
  providerArtifacts?: ReviewerProviderArtifacts;
}

export interface ReviewerRetryRecord {
  attempt: number;
  providerName: string;
  status: ProviderValidationStatus;
  validationError?: string;
  modelUsage: ReviewerModelUsageEstimate;
  cost: ReviewerCostEstimate;
}

export interface ValidatedReviewerProviderOutput extends ReviewerProviderOutput {
  reviewVerdict: ReviewVerdict;
  attempts: number;
  validation: {
    schema: "ReviewVerdictSchema";
    valid: true;
  };
  retry: {
    maxAttempts: number;
    attemptsUsed: number;
    invalidAttempts: number;
    records: ReviewerRetryRecord[];
  };
}

export interface ReviewerProviderRepairContext {
  invalidAttempt: number;
  invalidOutput: unknown;
  validationError: string;
  invalidProviderArtifacts?: ReviewerProviderArtifacts;
}

export interface ReviewerProvider {
  readonly name: string;
  readonly maxRepairAttempts?: number;
  review(input: ReviewerProviderInput): Promise<ReviewerProviderOutput>;
  repair?(input: ReviewerProviderInput, context: ReviewerProviderRepairContext): Promise<ReviewerProviderOutput>;
}

export interface ReviewerRetryOptions {
  maxAttempts?: number;
}

export interface ReviewerValidationFailureEvidence {
  providerName: string;
  maxAttempts: number;
  attemptsUsed: number;
  records: ReviewerRetryRecord[];
  lastValidationError?: string;
  lastInvalidOutput?: unknown;
  lastProviderArtifacts?: ReviewerProviderArtifacts;
}

export const ReviewerProviderSchedulerErrorCodes = {
  ProviderRateLimited: "SCHEDULER_REVIEWER_RATE_LIMIT",
  ProviderTimeout: "SCHEDULER_REVIEWER_TIMEOUT",
  ProviderNetwork: "SCHEDULER_REVIEWER_NETWORK",
  ProviderSchemaInvalid: "SCHEDULER_REVIEWER_SCHEMA_INVALID",
  ProviderContentPolicy: "SCHEDULER_REVIEWER_CONTENT_POLICY",
  ProviderAuth: "SCHEDULER_REVIEWER_AUTH",
} as const;

export type ReviewerProviderErrorCode = ProviderFailureCode;

export type ReviewerProviderSchedulerErrorCode =
  (typeof ReviewerProviderSchedulerErrorCodes)[keyof typeof ReviewerProviderSchedulerErrorCodes];

export class ReviewerProviderError extends Error {
  readonly code: ReviewerProviderErrorCode;
  readonly schedulerErrorCode: ReviewerProviderSchedulerErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(params: {
    code: ReviewerProviderErrorCode;
    schedulerErrorCode: ReviewerProviderSchedulerErrorCode;
    message: string;
    retryable: boolean;
    statusCode?: number;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "ReviewerProviderError";
    this.code = params.code;
    this.schedulerErrorCode = params.schedulerErrorCode;
    this.retryable = params.retryable;
    if (params.statusCode !== undefined) {
      this.statusCode = params.statusCode;
    }
    if (params.cause !== undefined) {
      this.cause = params.cause;
    }
  }
}

export class ReviewerProviderValidationError extends ReviewerProviderError {
  readonly evidence: ReviewerValidationFailureEvidence;

  constructor(evidence: ReviewerValidationFailureEvidence, cause: unknown) {
    super({
      code: "provider_schema_invalid",
      schedulerErrorCode: ReviewerProviderSchedulerErrorCodes.ProviderSchemaInvalid,
      message: `Reviewer provider ${evidence.providerName} returned invalid ReviewVerdict after ${evidence.attemptsUsed} attempts`,
      retryable: false,
      cause,
    });
    this.name = "ReviewerProviderValidationError";
    this.evidence = evidence;
  }
}

function maxAttemptsForProvider(provider: ReviewerProvider, requestedMaxAttempts: number): number {
  if (provider.maxRepairAttempts === undefined) {
    return requestedMaxAttempts;
  }

  return Math.min(requestedMaxAttempts, provider.maxRepairAttempts + 1);
}

export async function runReviewerProviderWithRetries(
  provider: ReviewerProvider,
  input: ReviewerProviderInput,
  options: ReviewerRetryOptions = {},
): Promise<ValidatedReviewerProviderOutput> {
  const maxAttempts = maxAttemptsForProvider(provider, options.maxAttempts ?? 2);
  let lastError: unknown;
  let lastInvalidOutput: unknown;
  let lastProviderArtifacts: ReviewerProviderArtifacts | undefined;
  const records: ReviewerRetryRecord[] = [];
  let repairContext: ReviewerProviderRepairContext | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const output =
      repairContext && provider.repair ? await provider.repair(input, repairContext) : await provider.review(input);

    try {
      const verdict = ReviewVerdictSchema.parse(output.reviewVerdict);
      records.push({
        attempt,
        providerName: output.providerName,
        status: "valid",
        modelUsage: output.modelUsage,
        cost: output.cost,
      });

      return {
        ...output,
        reviewVerdict: verdict,
        attempts: attempt,
        validation: {
          schema: "ReviewVerdictSchema",
          valid: true,
        },
        retry: {
          maxAttempts,
          attemptsUsed: attempt,
          invalidAttempts: records.filter((record) => record.status === "invalid").length,
          records,
        },
      };
    } catch (error) {
      lastError = error;
      lastInvalidOutput = output.reviewVerdict;
      lastProviderArtifacts = output.providerArtifacts;
      const validationError = error instanceof Error ? error.message : String(error);
      records.push({
        attempt,
        providerName: output.providerName,
        status: "invalid",
        validationError,
        modelUsage: output.modelUsage,
        cost: output.cost,
      });
      repairContext = {
        invalidAttempt: attempt,
        invalidOutput: output.reviewVerdict,
        validationError,
        ...(output.providerArtifacts ? { invalidProviderArtifacts: output.providerArtifacts } : {}),
      };
    }
  }

  throw new ReviewerProviderValidationError(
    {
      providerName: provider.name,
      maxAttempts,
      attemptsUsed: records.length,
      records,
      lastValidationError: lastError instanceof Error ? lastError.message : String(lastError),
      ...(lastInvalidOutput !== undefined ? { lastInvalidOutput } : {}),
      ...(lastProviderArtifacts ? { lastProviderArtifacts } : {}),
    },
    lastError,
  );
}
