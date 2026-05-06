import { ReviewerProviderInput, runReviewerProviderWithRetries } from "@kiwi/adapters";
import { KiwiPolicy, ModelEntry, ReviewVerdict } from "@kiwi/contracts";
import { appendAuditEvent } from "@kiwi/core";
import { persistReviewerProviderArtifacts, ReviewEngine, ReviewExecutionResult, ReviewInput } from "./review-engine";
import { ReviewerProviderRegistry } from "./reviewer-provider-registry";

export interface ProviderReviewEngineOptions {
  cwd: string;
  policy: KiwiPolicy;
  registryModels: ModelEntry[];
  env?: Record<string, string | undefined>;
  maxAttempts?: number;
  reviewerProviderRegistry?: ReviewerProviderRegistry;
}

function emptyDiffEnvelope(stepId: string): { diff: string; diffHash: string } {
  return { diff: `No diff captured for ${stepId}.`, diffHash: "sha256:empty" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reviewerPromptVersion(artifacts: { reviewerInput?: unknown; reviewerOutput?: unknown } | undefined): string {
  const reviewerInput = artifacts?.reviewerInput;
  if (isRecord(reviewerInput) && typeof reviewerInput.promptVersion === "string") {
    return reviewerInput.promptVersion;
  }
  const reviewerOutput = artifacts?.reviewerOutput;
  if (isRecord(reviewerOutput) && typeof reviewerOutput.promptVersion === "string") {
    return reviewerOutput.promptVersion;
  }
  return "unknown";
}

function buildReviewerInput(input: ReviewInput): ReviewerProviderInput {
  if (!input.step) {
    throw new Error("ProviderReviewEngine requires a focal step in ReviewInput");
  }
  const fallbackDiff = emptyDiffEnvelope(input.stepId);
  return {
    runId: input.runId,
    stepId: input.stepId,
    attemptId: input.attemptId,
    step: {
      stepId: input.step.stepId,
      type: input.step.type,
      title: input.step.title,
      successCriteria: input.step.successCriteria,
      requiredGates: input.step.requiredGates,
    },
    diff: input.diff ?? fallbackDiff.diff,
    diffHash: input.diffHash ?? fallbackDiff.diffHash,
    gateResults: input.gateResults,
    requestedAt: new Date().toISOString(),
  };
}

export class ProviderReviewEngine implements ReviewEngine {
  readonly name = "provider-review";

  constructor(private readonly options: ProviderReviewEngineOptions) {}

  async review(input: ReviewInput): Promise<ReviewVerdict> {
    return (await this.reviewWithExecution(input)).verdict;
  }

  async reviewWithExecution(input: ReviewInput): Promise<ReviewExecutionResult> {
    const reviewerInput = buildReviewerInput(input);
    const env = this.options.env ?? process.env;
    const registry = this.options.reviewerProviderRegistry ?? new ReviewerProviderRegistry();
    const selected = registry.select({
      registryModels: this.options.registryModels,
      policy: this.options.policy,
      env,
      riskHigh: input.riskHigh ?? false,
    });
    if (!selected) {
      throw new Error("No reviewer model with an available access mode is enabled in .kiwi/model-registry.yaml");
    }
    const { model, provider } = selected;

    appendAuditEvent(this.options.cwd, {
      eventType: "reviewer_provider_selected",
      runId: input.runId,
      timestamp: new Date().toISOString(),
      payload: {
        stepId: input.stepId,
        attemptId: input.attemptId,
        modelId: model.id,
        provider: model.provider,
        accessMode: model.accessMode,
        capability: model.capability,
        riskHigh: input.riskHigh ?? false,
      },
    });

    let validated;
    try {
      validated = await runReviewerProviderWithRetries(provider, reviewerInput, {
        maxAttempts: this.options.maxAttempts ?? 2,
      });
    } catch (error) {
      appendAuditEvent(this.options.cwd, {
        eventType: "reviewer_failed",
        runId: input.runId,
        timestamp: new Date().toISOString(),
        payload: {
          stepId: input.stepId,
          attemptId: input.attemptId,
          modelId: model.id,
          accessMode: model.accessMode,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }

    for (const record of validated.retry.records) {
      if (record.status !== "invalid") continue;
      appendAuditEvent(this.options.cwd, {
        eventType: "reviewer_retry",
        runId: input.runId,
        timestamp: new Date().toISOString(),
        payload: {
          stepId: input.stepId,
          attemptId: input.attemptId,
          attempt: record.attempt,
          providerName: record.providerName,
          validationError: record.validationError ?? "unknown",
        },
      });
    }

    appendAuditEvent(this.options.cwd, {
      eventType: "prompt_version_used",
      runId: input.runId,
      timestamp: new Date().toISOString(),
      payload: {
        phase: "reviewer",
        version: reviewerPromptVersion(validated.providerArtifacts),
        modelId: model.id,
      },
    });

    appendAuditEvent(this.options.cwd, {
      eventType: "reviewer_succeeded",
      runId: input.runId,
      timestamp: new Date().toISOString(),
      payload: {
        stepId: input.stepId,
        attemptId: input.attemptId,
        modelId: model.id,
        accessMode: model.accessMode,
        attemptsUsed: validated.retry.attemptsUsed,
        invalidAttempts: validated.retry.invalidAttempts,
        modelUsage: validated.modelUsage,
        cost: validated.cost,
      },
    });

    if (validated.providerArtifacts) {
      persistReviewerProviderArtifacts({
        cwd: this.options.cwd,
        runId: input.runId,
        stepId: input.stepId,
        attemptId: input.attemptId,
        reviewerInput: validated.providerArtifacts.reviewerInput,
        reviewerOutput: validated.providerArtifacts.reviewerOutput,
      });
    }

    return {
      verdict: validated.reviewVerdict,
      metadata: {
        modelId: model.id,
        providerName: validated.providerName,
        accessMode: model.accessMode,
        selectedCapability: model.capability,
        requestedCapability: model.capability,
        modelUsage: validated.modelUsage,
        estimatedCostUsd: validated.cost.estimatedUsd,
        diffHash: input.diffHash ?? null,
        attemptsUsed: validated.retry.attemptsUsed,
        invalidAttempts: validated.retry.invalidAttempts,
      },
    };
  }
}

export function createReviewEngineFromRegistry(options: ProviderReviewEngineOptions): ReviewEngine | null {
  const registry = options.reviewerProviderRegistry ?? new ReviewerProviderRegistry();
  const hasReviewer = registry.hasAvailableReviewer({
    registryModels: options.registryModels,
    policy: options.policy,
    env: options.env ?? process.env,
  });
  return hasReviewer ? new ProviderReviewEngine({ ...options, reviewerProviderRegistry: registry }) : null;
}
