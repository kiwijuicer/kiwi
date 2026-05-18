import {
  ReviewerProviderInput,
  ReviewerProviderValidationError,
  ReviewerValidationFailureEvidence,
  runReviewerProviderWithRetries,
  ValidatedReviewerProviderOutput,
} from "@kiwi/adapters";
import { ContractValues, KiwiPolicy, ModelEntry, ReviewVerdict } from "@kiwi/contracts";
import { appendAuditEvent } from "@kiwi/core";
import { persistReviewerProviderArtifacts, ReviewEngine, ReviewExecutionResult, ReviewInput } from "./review-engine";
import { ReviewerProviderRegistry, ReviewerProviderSelection } from "../registries/reviewer-provider-registry";

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

function invalidAttemptCount(evidence: ReviewerValidationFailureEvidence): number {
  return evidence.records.filter((record) => record.status === "invalid").length;
}

function annotateInvalidReviewerOutput(output: unknown, evidence: ReviewerValidationFailureEvidence): unknown {
  const validation = {
    schema: "ReviewVerdictSchema",
    valid: false,
    maxAttempts: evidence.maxAttempts,
    attemptsUsed: evidence.attemptsUsed,
    invalidAttempts: invalidAttemptCount(evidence),
    lastValidationError: evidence.lastValidationError ?? "unknown",
    records: evidence.records,
  };

  if (isRecord(output)) {
    return { ...output, validation };
  }

  return { output, validation };
}

function persistInvalidReviewerProviderArtifacts(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  evidence: ReviewerValidationFailureEvidence;
}): { reviewerInputRef: string; reviewerOutputRef: string } | null {
  const artifacts = params.evidence.lastProviderArtifacts;

  if (!artifacts) {
    return null;
  }

  return persistReviewerProviderArtifacts({
    cwd: params.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    reviewerInput: artifacts.reviewerInput ?? { promptVersion: "unknown" },
    reviewerOutput: annotateInvalidReviewerOutput(
      artifacts.reviewerOutput ?? { reviewVerdict: params.evidence.lastInvalidOutput ?? null },
      params.evidence,
    ),
  });
}

function appendReviewerRetryEvents(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  records: ReviewerValidationFailureEvidence["records"];
}): void {
  for (const record of params.records) {
    if (record.status !== "invalid") {
      continue;
    }
    appendAuditEvent(params.cwd, {
      eventType: "reviewer_retry",
      runId: params.runId,
      timestamp: new Date().toISOString(),
      payload: {
        stepId: params.stepId,
        attemptId: params.attemptId,
        attempt: record.attempt,
        providerName: record.providerName,
        validationError: record.validationError ?? "unknown",
      },
    });
  }
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

async function runReviewerValidation(params: {
  options: ProviderReviewEngineOptions;
  input: ReviewInput;
  reviewerInput: ReviewerProviderInput;
  selected: ReviewerProviderSelection;
}): Promise<ValidatedReviewerProviderOutput> {
  try {
    return await runReviewerProviderWithRetries(params.selected.provider, params.reviewerInput, {
      maxAttempts: params.options.maxAttempts ?? 2,
    });
  } catch (error) {
    if (error instanceof ReviewerProviderValidationError) {
      appendReviewerRetryEvents({
        cwd: params.options.cwd,
        runId: params.input.runId,
        stepId: params.input.stepId,
        attemptId: params.input.attemptId,
        records: error.evidence.records,
      });
      const invalidArtifactRefs = persistInvalidReviewerProviderArtifacts({
        cwd: params.options.cwd,
        runId: params.input.runId,
        stepId: params.input.stepId,
        attemptId: params.input.attemptId,
        evidence: error.evidence,
      });
      appendAuditEvent(params.options.cwd, {
        eventType: "reviewer_validation_failed",
        runId: params.input.runId,
        timestamp: new Date().toISOString(),
        payload: {
          stepId: params.input.stepId,
          attemptId: params.input.attemptId,
          providerName: error.evidence.providerName,
          attemptsUsed: error.evidence.attemptsUsed,
          maxAttempts: error.evidence.maxAttempts,
          invalidAttempts: invalidAttemptCount(error.evidence),
          lastValidationError: error.evidence.lastValidationError ?? "unknown",
          ...(invalidArtifactRefs ? invalidArtifactRefs : {}),
        },
      });
    }
    appendAuditEvent(params.options.cwd, {
      eventType: "reviewer_failed",
      runId: params.input.runId,
      timestamp: new Date().toISOString(),
      payload: {
        stepId: params.input.stepId,
        attemptId: params.input.attemptId,
        modelId: params.selected.model.id,
        accessMode: params.selected.model.accessMode,
        message: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

function appendReviewerSuccessEvidence(params: {
  options: ProviderReviewEngineOptions;
  input: ReviewInput;
  model: ModelEntry;
  validated: ValidatedReviewerProviderOutput;
}): void {
  appendReviewerRetryEvents({
    cwd: params.options.cwd,
    runId: params.input.runId,
    stepId: params.input.stepId,
    attemptId: params.input.attemptId,
    records: params.validated.retry.records,
  });

  appendAuditEvent(params.options.cwd, {
    eventType: "prompt_version_used",
    runId: params.input.runId,
    timestamp: new Date().toISOString(),
    payload: {
      phase: ContractValues.Reviewer,
      version: reviewerPromptVersion(params.validated.providerArtifacts),
      modelId: params.model.id,
    },
  });

  appendAuditEvent(params.options.cwd, {
    eventType: "reviewer_succeeded",
    runId: params.input.runId,
    timestamp: new Date().toISOString(),
    payload: {
      stepId: params.input.stepId,
      attemptId: params.input.attemptId,
      modelId: params.model.id,
      accessMode: params.model.accessMode,
      attemptsUsed: params.validated.retry.attemptsUsed,
      invalidAttempts: params.validated.retry.invalidAttempts,
      modelUsage: params.validated.modelUsage,
      cost: params.validated.cost,
    },
  });

  if (params.validated.providerArtifacts) {
    persistReviewerProviderArtifacts({
      cwd: params.options.cwd,
      runId: params.input.runId,
      stepId: params.input.stepId,
      attemptId: params.input.attemptId,
      reviewerInput: params.validated.providerArtifacts.reviewerInput,
      reviewerOutput: params.validated.providerArtifacts.reviewerOutput,
    });
  }
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
    const { model } = selected;

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
    if ((this.options.policy.routing.providerPreference.reviewer ?? []).length > 0) {
      appendAuditEvent(this.options.cwd, {
        eventType: "provider_preference_applied",
        runId: input.runId,
        timestamp: new Date().toISOString(),
        payload: {
          stepId: input.stepId,
          attemptId: input.attemptId,
          role: ContractValues.Reviewer,
          selectedAccessMode: model.accessMode,
          selectedModelId: model.id,
          preference: this.options.policy.routing.providerPreference.reviewer ?? [],
        },
      });
    }

    const validated = await runReviewerValidation({ options: this.options, input, reviewerInput, selected });
    appendReviewerSuccessEvidence({ options: this.options, input, model, validated });

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
