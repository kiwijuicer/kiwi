import { AccessMode, ContractValues, KiwiPolicy } from "@kiwi/contracts";
import type { ProviderAttemptType } from "../constants";
import { extractTextJson, isRecord } from "../integrations/anthropic/common";
import { CliPlannerResult, extractCliPlannerText, formatExternalCliFailure } from "./cli-planner";
import {
  buildReviewerRepairEnvelope,
  buildReviewerUserEnvelope,
  reviewerToolDefinition,
  REVIEWER_JSON_SYSTEM_PROMPT,
  REVIEWER_PROMPT_VERSION,
} from "../prompts/reviewer-v1";
import { redactForProvider, RedactionSummary } from "./redaction";
import { buildRunnerEnv } from "../runners/env";
import {
  ReviewerProviderArtifacts,
  ReviewerProviderError,
  ReviewerProviderErrorCode,
  ReviewerProviderInput,
  ReviewerProviderOutput,
  ReviewerProviderRepairContext,
  ReviewerProviderSchedulerErrorCodes,
} from "./reviewer";

export interface CliReviewerUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

interface CliReviewerInvokeParams {
  providerName: string;
  label: string;
  accessMode: AccessMode;
  binary: string;
  model: string | undefined;
  input: ReviewerProviderInput;
  attemptType: ProviderAttemptType;
  context?: ReviewerProviderRepairContext;
  env: Record<string, string | undefined>;
  policy: KiwiPolicy;
  timeoutMs: number;
  run: (prompt: string, env: Record<string, string | undefined>) => Promise<CliPlannerResult>;
  normalizeUsage: (parsed: unknown) => CliReviewerUsage;
}

interface RedactedInvocationArtifact {
  attemptType: ProviderAttemptType;
  promptVersion: string;
  model: string;
  binary: string;
  args: string[];
  prompt: string;
  redaction: RedactionSummary;
}

function providerError(params: {
  code: ReviewerProviderErrorCode;
  message: string;
  retryable: boolean;
  cause?: unknown;
}): ReviewerProviderError {
  const schedulerErrorCode =
    params.code === "provider_timeout"
      ? ReviewerProviderSchedulerErrorCodes.ProviderTimeout
      : params.code === "provider_schema_invalid"
        ? ReviewerProviderSchedulerErrorCodes.ProviderSchemaInvalid
        : params.code === "provider_auth"
          ? ReviewerProviderSchedulerErrorCodes.ProviderAuth
          : ReviewerProviderSchedulerErrorCodes.ProviderNetwork;

  return new ReviewerProviderError({
    code: params.code,
    schedulerErrorCode,
    message: params.message,
    retryable: params.retryable,
    ...(params.cause !== undefined ? { cause: params.cause } : {}),
  });
}

function previousAttempts(context?: ReviewerProviderRepairContext): unknown[] {
  const artifact = context?.invalidProviderArtifacts?.reviewerInput;

  if (!isRecord(artifact) || !Array.isArray(artifact.attempts)) {
    return [];
  }

  return artifact.attempts.filter((entry): entry is Record<string, unknown> => isRecord(entry));
}

function buildPrompt(params: {
  input: ReviewerProviderInput;
  attemptType: ProviderAttemptType;
  context?: ReviewerProviderRepairContext;
  policy: KiwiPolicy;
  env: Record<string, string | undefined>;
}): ReturnType<typeof redactForProvider<string>> {
  const userEnvelope =
    params.attemptType === "repair" && params.context
      ? buildReviewerRepairEnvelope({
          input: params.input,
          invalidAttempt: params.context.invalidAttempt,
          invalidOutput: params.context.invalidOutput,
          validationError: params.context.validationError,
        })
      : buildReviewerUserEnvelope(params.input);
  const schema = JSON.stringify(reviewerToolDefinition().input_schema, null, 2);

  return redactForProvider(
    `${REVIEWER_JSON_SYSTEM_PROMPT}

Prompt version: ${REVIEWER_PROMPT_VERSION}

ReviewVerdict JSON schema:
${schema}

Reviewer request:
${userEnvelope}

Return only a JSON ReviewVerdict; no commentary or extra top-level keys.`,
    params.policy,
    params.env,
  );
}

export async function invokeCliReviewer(params: CliReviewerInvokeParams): Promise<ReviewerProviderOutput> {
  const redactedPrompt = buildPrompt({
    input: params.input,
    attemptType: params.attemptType,
    ...(params.context ? { context: params.context } : {}),
    policy: params.policy,
    env: params.env,
  });
  const env = buildRunnerEnv({ sourceEnv: params.env, policy: params.policy.commandProfiles.default });
  const result = await params.run(redactedPrompt.redacted, env);

  if (!result.ok) {
    throw providerError({
      code: result.timedOut ? "provider_timeout" : "provider_network",
      message: result.timedOut
        ? `${params.label} reviewer request timed out after ${params.timeoutMs}ms`
        : formatExternalCliFailure(`${params.label} reviewer`, result),
      retryable: result.timedOut,
    });
  }

  const text = extractCliPlannerText(result.parsed, result.stdout);
  const reviewVerdict = extractTextJson(text);

  if (reviewVerdict === null) {
    throw providerError({
      code: "provider_schema_invalid",
      message: `${params.label} reviewer did not return parseable JSON`,
      retryable: false,
    });
  }

  const usage = params.normalizeUsage(result.parsed);
  const previous = previousAttempts(params.context);
  const attemptArtifact: RedactedInvocationArtifact = {
    attemptType: params.attemptType,
    promptVersion: REVIEWER_PROMPT_VERSION,
    model: params.model ?? "default",
    binary: params.binary,
    args: result.args,
    prompt: redactedPrompt.redacted,
    redaction: redactedPrompt.summary,
  };
  const cliArtifact = redactForProvider(result.parsed ?? result.stdout, params.policy, params.env);
  const providerArtifacts: ReviewerProviderArtifacts = {
    reviewerInput: {
      promptVersion: REVIEWER_PROMPT_VERSION,
      accessMode: params.accessMode,
      model: params.model ?? "default",
      attempts: [...previous, attemptArtifact],
    },
    reviewerOutput: {
      promptVersion: REVIEWER_PROMPT_VERSION,
      accessMode: params.accessMode,
      model: params.model ?? "default",
      cli: {
        binary: params.binary,
        args: result.args,
        stdout: redactForProvider(result.stdout, params.policy, params.env).redacted,
        stderr: redactForProvider(result.stderr, params.policy, params.env).redacted,
        durationMs: result.durationMs,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
      },
      envelope: cliArtifact.redacted,
      reviewVerdict,
    },
  };

  return {
    providerName: params.providerName,
    reviewVerdict,
    modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
    cost: { estimatedUsd: usage.estimatedCostUsd ?? 0, currency: "USD" },
    providerArtifacts,
  };
}

export function emptyReviewerPolicy(): KiwiPolicy {
  return {
    version: "1",
    project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
    commands: { test: "", lint: "", typecheck: "" },
    routing: {
      defaultAgentRole: ContractValues.Executor,
      defaultModelCapability: ContractValues.Mid,
      providerPreference: {},
      stepTypeOverrides: {},
    },
    riskZones: { high: [] },
    approvals: { requireFor: [], commandApprovalStates: {} },
    commandProfiles: {},
  };
}
