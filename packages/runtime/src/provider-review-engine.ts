import {
  AnthropicReviewerProvider,
  ClaudeCodeCliReviewerProvider,
  ReviewerProvider,
  ReviewerProviderInput,
  runReviewerProviderWithRetries,
} from "@kiwi/adapters";
import { ContractValues, KiwiPolicy, ModelEntry, ReviewVerdict } from "@kiwi/contracts";
import {
  appendAuditEvent,
  persistReviewerProviderArtifacts,
  ReviewEngine,
  ReviewExecutionResult,
  ReviewInput,
} from "@kiwi/core";
import { selectEnabledModelByAccessMode } from "./access-mode-resolver";

export interface ProviderReviewEngineOptions {
  cwd: string;
  policy: KiwiPolicy;
  registryModels: ModelEntry[];
  env?: Record<string, string | undefined>;
  maxAttempts?: number;
}

function buildReviewerProvider(
  model: ModelEntry,
  env: Record<string, string | undefined>,
  policy: KiwiPolicy,
): ReviewerProvider {
  if (model.accessMode === "anthropic-api") {
    return new AnthropicReviewerProvider({ model: model.id, env, policy });
  }
  if (model.accessMode === "claude-code-cli") {
    return new ClaudeCodeCliReviewerProvider({ model: model.id, env, policy });
  }
  throw new Error(`Reviewer access mode '${model.accessMode}' is not supported yet (modelId: ${model.id}).`);
}

function emptyDiffEnvelope(stepId: string): { diff: string; diffHash: string } {
  return { diff: `No diff captured for ${stepId}.`, diffHash: "sha256:empty" };
}

function pickReviewerCandidates(models: ModelEntry[], riskHigh: boolean): ModelEntry[] {
  const reviewers = models.filter((model) => model.roles.includes(ContractValues.Reviewer));
  const targetCapability = riskHigh ? ContractValues.Frontier : ContractValues.Strong;
  const exact = reviewers.filter((model) => model.capability === targetCapability);
  if (exact.length > 0) return exact;
  const frontier = reviewers.filter((model) => model.capability === ContractValues.Frontier);
  if (frontier.length > 0) return frontier;
  const strong = reviewers.filter((model) => model.capability === ContractValues.Strong);
  if (strong.length > 0) return strong;
  return reviewers;
}

export class ProviderReviewEngine implements ReviewEngine {
  readonly name = "provider-review";

  constructor(private readonly options: ProviderReviewEngineOptions) {}

  async review(input: ReviewInput): Promise<ReviewVerdict> {
    return (await this.reviewWithExecution(input)).verdict;
  }

  async reviewWithExecution(input: ReviewInput): Promise<ReviewExecutionResult> {
    if (!input.step) {
      throw new Error("ProviderReviewEngine requires a focal step in ReviewInput");
    }

    const env = this.options.env ?? process.env;
    const candidates = pickReviewerCandidates(this.options.registryModels, input.riskHigh ?? false);
    const selected = selectEnabledModelByAccessMode({ candidates, env, excludeStub: true });
    if (!selected) {
      throw new Error("No reviewer model with an available access mode is enabled in model-registry.yaml");
    }
    const { model } = selected;
    const provider = buildReviewerProvider(model, env, this.options.policy);

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

    const fallbackDiff = emptyDiffEnvelope(input.stepId);
    const reviewerInput: ReviewerProviderInput = {
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
  const env = options.env ?? process.env;
  const reviewers = options.registryModels.filter(
    (model) => model.enabled && model.roles.includes(ContractValues.Reviewer),
  );
  if (reviewers.length === 0) return null;
  const candidatesHigh = pickReviewerCandidates(options.registryModels, true);
  const candidatesStandard = pickReviewerCandidates(options.registryModels, false);
  const probeHigh = selectEnabledModelByAccessMode({ candidates: candidatesHigh, env, excludeStub: true });
  const probeStandard = selectEnabledModelByAccessMode({ candidates: candidatesStandard, env, excludeStub: true });
  if (!probeHigh && !probeStandard) return null;
  return new ProviderReviewEngine(options);
}
