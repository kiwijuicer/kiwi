import { Initiative, KiwiPolicy, TaskGraph, TaskGraphSchema } from "@kiwi/contracts";
import type { ProviderFailureCode, ProviderValidationStatus } from "../constants";

export interface PlannerProviderInput {
  runId: string;
  initiative: Initiative;
  policy: KiwiPolicy;
  requestedAt: string;
}

export interface ModelUsageEstimate {
  inputTokens: number;
  outputTokens: number;
}

export interface CostEstimate {
  estimatedUsd: number;
  currency: "USD";
}

export interface PlannerProviderArtifacts {
  plannerInput?: unknown;
  plannerOutput?: unknown;
}

export interface PlannerProviderOutput {
  providerName: string;
  taskGraph: unknown;
  modelUsage: ModelUsageEstimate;
  cost: CostEstimate;
  providerArtifacts?: PlannerProviderArtifacts;
}

export interface PlannerRetryRecord {
  attempt: number;
  providerName: string;
  status: ProviderValidationStatus;
  validationError?: string;
  modelUsage: ModelUsageEstimate;
  cost: CostEstimate;
}

export interface ValidatedPlannerProviderOutput extends PlannerProviderOutput {
  taskGraph: TaskGraph;
  attempts: number;
  validation: {
    schema: "TaskGraphSchema";
    valid: true;
  };
  retry: {
    maxAttempts: number;
    attemptsUsed: number;
    invalidAttempts: number;
    records: PlannerRetryRecord[];
  };
}

export interface PlannerProvider {
  readonly name: string;
  readonly maxRepairAttempts?: number;
  plan(input: PlannerProviderInput): Promise<PlannerProviderOutput>;
  repair?(input: PlannerProviderInput, context: PlannerProviderRepairContext): Promise<PlannerProviderOutput>;
}

export interface RetryOptions {
  maxAttempts?: number;
}

export interface PlannerProviderRepairContext {
  invalidAttempt: number;
  invalidOutput: unknown;
  validationError: string;
  invalidProviderArtifacts?: PlannerProviderArtifacts;
}

export interface PlannerValidationFailureEvidence {
  providerName: string;
  maxAttempts: number;
  attemptsUsed: number;
  records: PlannerRetryRecord[];
  lastValidationError?: string;
}

export const PlannerProviderSchedulerErrorCodes = {
  ProviderRateLimited: "SCHEDULER_PROVIDER_RATE_LIMIT",
  ProviderTimeout: "SCHEDULER_PROVIDER_TIMEOUT",
  ProviderNetwork: "SCHEDULER_PROVIDER_NETWORK",
  ProviderSchemaInvalid: "SCHEDULER_PROVIDER_SCHEMA_INVALID",
  ProviderContentPolicy: "SCHEDULER_PROVIDER_CONTENT_POLICY",
  ProviderAuth: "SCHEDULER_PROVIDER_AUTH",
} as const;

export type PlannerProviderErrorCode = ProviderFailureCode;

export type PlannerProviderSchedulerErrorCode =
  (typeof PlannerProviderSchedulerErrorCodes)[keyof typeof PlannerProviderSchedulerErrorCodes];

export class PlannerProviderError extends Error {
  readonly code: PlannerProviderErrorCode;
  readonly schedulerErrorCode: PlannerProviderSchedulerErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(params: {
    code: PlannerProviderErrorCode;
    schedulerErrorCode: PlannerProviderSchedulerErrorCode;
    message: string;
    retryable: boolean;
    statusCode?: number;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "PlannerProviderError";
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

export class PlannerProviderValidationError extends PlannerProviderError {
  readonly evidence: PlannerValidationFailureEvidence;

  constructor(evidence: PlannerValidationFailureEvidence, cause: unknown) {
    super({
      code: "provider_schema_invalid",
      schedulerErrorCode: PlannerProviderSchedulerErrorCodes.ProviderSchemaInvalid,
      message: `Planner provider ${evidence.providerName} returned invalid TaskGraph after ${evidence.attemptsUsed} attempts`,
      retryable: false,
      cause,
    });
    this.name = "PlannerProviderValidationError";
    this.evidence = evidence;
  }
}

function validateExecutableTaskGraph(taskGraph: TaskGraph): void {
  const issues = taskGraph.steps.flatMap((step) => {
    const stepIssues: string[] = [];

    if (step.type === "review") {
      stepIssues.push(`${step.stepId}: standalone review steps are redundant because kiwi reviews every attempt`);
    }
    if (step.requiredGates.includes("structured_review_json")) {
      stepIssues.push(`${step.stepId}: structured_review_json is produced by the review engine, not a runnable gate`);
    }

    return stepIssues;
  });

  if (issues.length > 0) {
    throw new Error(`TaskGraph is not executable by kiwi run: ${issues.join("; ")}`);
  }
}

function maxAttemptsForProvider(provider: PlannerProvider, requestedMaxAttempts: number): number {
  if (provider.maxRepairAttempts === undefined) {
    return requestedMaxAttempts;
  }

  return Math.min(requestedMaxAttempts, provider.maxRepairAttempts + 1);
}

export async function runPlannerProviderWithRetries(
  provider: PlannerProvider,
  input: PlannerProviderInput,
  options: RetryOptions = {},
): Promise<ValidatedPlannerProviderOutput> {
  const maxAttempts = maxAttemptsForProvider(provider, options.maxAttempts ?? 2);
  let lastError: unknown;
  const records: PlannerRetryRecord[] = [];
  let repairContext: PlannerProviderRepairContext | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const output =
      repairContext && provider.repair ? await provider.repair(input, repairContext) : await provider.plan(input);

    try {
      const taskGraph = TaskGraphSchema.parse(output.taskGraph);
      validateExecutableTaskGraph(taskGraph);
      records.push({
        attempt,
        providerName: output.providerName,
        status: "valid",
        modelUsage: output.modelUsage,
        cost: output.cost,
      });

      return {
        ...output,
        taskGraph,
        attempts: attempt,
        validation: {
          schema: "TaskGraphSchema",
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
        invalidOutput: output.taskGraph,
        validationError,
        ...(output.providerArtifacts ? { invalidProviderArtifacts: output.providerArtifacts } : {}),
      };
    }
  }

  throw new PlannerProviderValidationError(
    {
      providerName: provider.name,
      maxAttempts,
      attemptsUsed: records.length,
      records,
      lastValidationError: lastError instanceof Error ? lastError.message : String(lastError),
    },
    lastError,
  );
}
