import { Initiative, KiwiPolicy, TaskGraph, TaskGraphSchema } from "@kiwi/contracts";

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

export interface PlannerProviderOutput {
  providerName: string;
  taskGraph: unknown;
  modelUsage: ModelUsageEstimate;
  cost: CostEstimate;
}

export interface PlannerRetryRecord {
  attempt: number;
  providerName: string;
  status: "valid" | "invalid";
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
  plan(input: PlannerProviderInput): Promise<PlannerProviderOutput>;
}

export interface RetryOptions {
  maxAttempts?: number;
}

export interface PlannerValidationFailureEvidence {
  providerName: string;
  maxAttempts: number;
  attemptsUsed: number;
  records: PlannerRetryRecord[];
  lastValidationError?: string;
}

export class PlannerProviderValidationError extends Error {
  readonly evidence: PlannerValidationFailureEvidence;

  constructor(evidence: PlannerValidationFailureEvidence, cause: unknown) {
    super(
      `Planner provider ${evidence.providerName} returned invalid TaskGraph after ${evidence.attemptsUsed} attempts`,
    );
    this.name = "PlannerProviderValidationError";
    this.evidence = evidence;
    this.cause = cause;
  }
}

export async function runPlannerProviderWithRetries(
  provider: PlannerProvider,
  input: PlannerProviderInput,
  options: RetryOptions = {},
): Promise<ValidatedPlannerProviderOutput> {
  const maxAttempts = options.maxAttempts ?? 2;
  let lastError: unknown;
  const records: PlannerRetryRecord[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const output = await provider.plan(input);
    try {
      const taskGraph = TaskGraphSchema.parse(output.taskGraph);
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
      records.push({
        attempt,
        providerName: output.providerName,
        status: "invalid",
        validationError: error instanceof Error ? error.message : String(error),
        modelUsage: output.modelUsage,
        cost: output.cost,
      });
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
