import {
  Initiative,
  KiwiPolicy,
  TaskGraph,
  TaskGraphSchema,
} from "@ai-kiwi/contracts";

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

export interface ValidatedPlannerProviderOutput extends PlannerProviderOutput {
  taskGraph: TaskGraph;
  attempts: number;
  validation: {
    schema: "TaskGraphSchema";
    valid: true;
  };
}

export interface PlannerProvider {
  readonly name: string;
  plan(input: PlannerProviderInput): Promise<PlannerProviderOutput>;
}

export interface RetryOptions {
  maxAttempts?: number;
}

export class PlannerProviderValidationError extends Error {
  constructor(
    providerName: string,
    attempts: number,
    cause: unknown,
  ) {
    super(`Planner provider ${providerName} returned invalid TaskGraph after ${attempts} attempts`);
    this.name = "PlannerProviderValidationError";
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

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const output = await provider.plan(input);
    try {
      const taskGraph = TaskGraphSchema.parse(output.taskGraph);
      return {
        ...output,
        taskGraph,
        attempts: attempt,
        validation: {
          schema: "TaskGraphSchema",
          valid: true,
        },
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new PlannerProviderValidationError(provider.name, maxAttempts, lastError);
}
