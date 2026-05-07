import {
  ClaudeCodeCliInvocation,
  ClaudeCodeCliRunner,
  DefaultClaudeCodeCliRunner,
  extractCliResultText,
  normalizeUsageFromCli,
} from "./client";
import { ContractValues, KiwiPolicy } from "@kiwi/contracts";
import { extractTextJson } from "../anthropic-common";
import { redactForProvider, RedactionSummary } from "../provider-redaction";
import { buildRunnerEnv } from "../runner-env";
import {
  buildReviewerRepairEnvelope,
  buildReviewerUserEnvelope,
  REVIEWER_PROMPT_VERSION,
  REVIEWER_SYSTEM_PROMPT,
} from "../prompts/reviewer/v1";
import {
  ReviewerProvider,
  ReviewerProviderArtifacts,
  ReviewerProviderError,
  ReviewerProviderErrorCode,
  ReviewerProviderInput,
  ReviewerProviderOutput,
  ReviewerProviderRepairContext,
  ReviewerProviderSchedulerErrorCodes,
} from "../reviewer-provider";

const DEFAULT_TIMEOUT_MS = 180_000;

export interface ClaudeCodeCliReviewerProviderOptions {
  binary?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  maxRepairAttempts?: number;
  runner?: ClaudeCodeCliRunner;
  env?: Record<string, string | undefined>;
  policy?: KiwiPolicy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function emptyPolicy(): KiwiPolicy {
  return {
    version: "1",
    project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
    commands: { test: "", lint: "", typecheck: "" },
    routing: {
      defaultAgentRole: ContractValues.Executor,
      defaultModelCapability: ContractValues.Mid,
      stepTypeOverrides: {},
    },
    riskZones: { high: [] },
    approvals: { requireFor: [], commandApprovalStates: {} },
    commandProfiles: {},
  };
}

function previousAttempts(context?: ReviewerProviderRepairContext): unknown[] {
  const artifact = context?.invalidProviderArtifacts?.reviewerInput;
  if (!isRecord(artifact) || !Array.isArray(artifact.attempts)) return [];
  return artifact.attempts.filter((entry): entry is Record<string, unknown> => isRecord(entry));
}

export class ClaudeCodeCliReviewerProvider implements ReviewerProvider {
  readonly name: string;
  readonly maxRepairAttempts: number;
  private readonly binary: string;
  private readonly cwd: string | undefined;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly runner: ClaudeCodeCliRunner;
  private readonly env: Record<string, string | undefined>;
  private readonly policy: KiwiPolicy;

  constructor(options: ClaudeCodeCliReviewerProviderOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CLAUDE_CODE_BINARY ?? "claude";
    if (options.cwd !== undefined) this.cwd = options.cwd;
    this.model = options.model;
    this.name = `claude-code-cli:${this.model ?? "default"}`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRepairAttempts = options.maxRepairAttempts ?? 1;
    this.runner = options.runner ?? new DefaultClaudeCodeCliRunner();
    this.env = options.env ?? process.env;
    this.policy = options.policy ?? emptyPolicy();
  }

  async review(input: ReviewerProviderInput): Promise<ReviewerProviderOutput> {
    return this.invoke({ input, attemptType: "initial", envelope: buildReviewerUserEnvelope(input) });
  }

  async repair(input: ReviewerProviderInput, context: ReviewerProviderRepairContext): Promise<ReviewerProviderOutput> {
    return this.invoke({
      input,
      attemptType: "repair",
      envelope: buildReviewerRepairEnvelope({
        input,
        invalidAttempt: context.invalidAttempt,
        invalidOutput: context.invalidOutput,
        validationError: context.validationError,
      }),
      context,
    });
  }

  private async invoke(params: {
    input: ReviewerProviderInput;
    attemptType: "initial" | "repair";
    envelope: string;
    context?: ReviewerProviderRepairContext;
  }): Promise<ReviewerProviderOutput> {
    const redacted = redactForProvider(params.envelope, this.policy, this.env);
    const systemPrompt = `${REVIEWER_SYSTEM_PROMPT}\n\nReturn only a JSON ReviewVerdict; no commentary.`;
    const env = buildRunnerEnv({ sourceEnv: this.env, policy: this.policy.commandProfiles.default });
    const invocation: ClaudeCodeCliInvocation = {
      binary: this.binary,
      ...(this.cwd ? { cwd: this.cwd } : {}),
      ...(this.model ? { model: this.model } : {}),
      prompt: redacted.redacted,
      systemPrompt,
      outputFormat: "json",
      timeoutMs: this.timeoutMs,
      env,
    };
    const result = await this.runner.run(invocation);
    if (!result.ok) {
      throw providerError({
        code: result.timedOut ? "provider_timeout" : "provider_network",
        message: result.timedOut
          ? `claude-code-cli reviewer request timed out after ${this.timeoutMs}ms`
          : `claude-code-cli reviewer exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`,
        retryable: result.timedOut,
      });
    }

    const text = extractCliResultText(result.parsed, result.stdout);
    const reviewVerdict = extractTextJson(text);
    if (reviewVerdict === null) {
      throw providerError({
        code: "provider_schema_invalid",
        message: "claude-code-cli reviewer did not return parseable JSON",
        retryable: false,
      });
    }

    const usage = normalizeUsageFromCli(result.parsed);
    const previous = previousAttempts(params.context);
    const attemptArtifact = {
      attemptType: params.attemptType,
      promptVersion: REVIEWER_PROMPT_VERSION,
      model: this.model ?? "default",
      binary: this.binary,
      args: result.args,
      prompt: redacted.redacted,
      systemPrompt,
      redaction: redacted.summary as RedactionSummary,
    };
    const cliArtifact = redactForProvider(result.parsed ?? result.stdout, this.policy, this.env);
    const redactedStdout = redactForProvider(result.stdout, this.policy, this.env).redacted;
    const redactedStderr = redactForProvider(result.stderr, this.policy, this.env).redacted;
    const providerArtifacts: ReviewerProviderArtifacts = {
      reviewerInput: {
        promptVersion: REVIEWER_PROMPT_VERSION,
        accessMode: "claude-code-cli",
        model: this.model ?? "default",
        attempts: [...previous, attemptArtifact],
      },
      reviewerOutput: {
        promptVersion: REVIEWER_PROMPT_VERSION,
        accessMode: "claude-code-cli",
        model: this.model ?? "default",
        cli: {
          binary: this.binary,
          args: result.args,
          stdout: redactedStdout,
          stderr: redactedStderr,
          durationMs: result.durationMs,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
        },
        envelope: cliArtifact.redacted,
        reviewVerdict,
      },
    };

    return {
      providerName: this.name,
      reviewVerdict,
      modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      cost: { estimatedUsd: usage.estimatedCostUsd ?? 0, currency: "USD" },
      providerArtifacts,
    };
  }
}
