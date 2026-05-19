import { extractTextJson } from "../../providers/json-utils.js";
import type { ProviderAttemptType } from "../../constants.js";
import {
  ClaudeCodeCliInvocation,
  ClaudeCodeCliRunner,
  DefaultClaudeCodeCliRunner,
  extractCliResultText,
  formatCliFailure,
  normalizeUsageFromCli,
} from "./client.js";
import {
  PlannerProvider,
  PlannerProviderArtifacts,
  PlannerProviderError,
  PlannerProviderErrorCode,
  PlannerProviderInput,
  PlannerProviderOutput,
  PlannerProviderRepairContext,
  PlannerProviderSchedulerErrorCodes,
} from "../../providers/planner.js";
import { redactForProvider, RedactionSummary } from "../../providers/redaction.js";
import { buildRunnerEnv } from "../../runners/env.js";
import {
  buildPlannerRepairEnvelope,
  buildPlannerUserEnvelope,
  plannerToolDefinition,
  PLANNER_PROMPT_VERSION,
  PLANNER_SYSTEM_PROMPT,
} from "../../prompts/planner-v1/index.js";
import { buildRepoContextEnvelope, RepoContextEnvelope, renderRepoContext } from "../../providers/repo-context.js";

export interface ClaudeCodeCliPlannerProviderOptions {
  binary?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  maxRepairAttempts?: number;
  runner?: ClaudeCodeCliRunner;
  env?: Record<string, string | undefined>;
}

const DEFAULT_TIMEOUT_MS = 180_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerError(params: {
  code: PlannerProviderErrorCode;
  message: string;
  retryable: boolean;
  cause?: unknown;
}): PlannerProviderError {
  const schedulerErrorCode =
    params.code === "provider_timeout"
      ? PlannerProviderSchedulerErrorCodes.ProviderTimeout
      : params.code === "provider_schema_invalid"
        ? PlannerProviderSchedulerErrorCodes.ProviderSchemaInvalid
        : params.code === "provider_auth"
          ? PlannerProviderSchedulerErrorCodes.ProviderAuth
          : PlannerProviderSchedulerErrorCodes.ProviderNetwork;

  return new PlannerProviderError({
    code: params.code,
    schedulerErrorCode,
    message: params.message,
    retryable: params.retryable,
    ...(params.cause !== undefined ? { cause: params.cause } : {}),
  });
}

function previousAttempts(context?: PlannerProviderRepairContext): unknown[] {
  const artifact = context?.invalidProviderArtifacts?.plannerInput;

  if (!isRecord(artifact) || !Array.isArray(artifact.attempts)) {
    return [];
  }

  return artifact.attempts.filter((entry): entry is Record<string, unknown> => isRecord(entry));
}

interface RedactedInvocationArtifact {
  attemptType: ProviderAttemptType;
  promptVersion: string;
  model: string;
  binary: string;
  args: string[];
  prompt: string;
  systemPrompt: string;
  redaction: RedactionSummary;
}

function mergeRedactionSummaries(...summaries: RedactionSummary[]): RedactionSummary {
  return {
    secretEnvNames: [...new Set(summaries.flatMap((summary) => summary.secretEnvNames))].sort(),
    envSecretValuesRedacted: summaries.reduce((total, summary) => total + summary.envSecretValuesRedacted, 0),
    detectedPatterns: [...new Set(summaries.flatMap((summary) => summary.detectedPatterns))].sort(),
  };
}

export class ClaudeCodeCliPlannerProvider implements PlannerProvider {
  readonly name: string;
  readonly maxRepairAttempts: number;
  private readonly binary: string;
  private readonly cwd: string | undefined;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly runner: ClaudeCodeCliRunner;
  private readonly env: Record<string, string | undefined>;

  constructor(options: ClaudeCodeCliPlannerProviderOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CLAUDE_CODE_BINARY ?? "claude";
    if (options.cwd !== undefined) {
      this.cwd = options.cwd;
    }
    this.model = options.model;
    this.name = `claude-code-cli:${this.model ?? "default"}`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRepairAttempts = options.maxRepairAttempts ?? 1;
    this.runner = options.runner ?? new DefaultClaudeCodeCliRunner();
    this.env = options.env ?? process.env;
  }

  async plan(input: PlannerProviderInput): Promise<PlannerProviderOutput> {
    return this.invoke({
      input,
      attemptType: "initial",
      userEnvelope: buildPlannerUserEnvelope(input),
    });
  }

  async repair(input: PlannerProviderInput, context: PlannerProviderRepairContext): Promise<PlannerProviderOutput> {
    return this.invoke({
      input,
      attemptType: "repair",
      userEnvelope: buildPlannerRepairEnvelope({
        input,
        invalidAttempt: context.invalidAttempt,
        invalidOutput: context.invalidOutput,
        validationError: context.validationError,
      }),
      context,
    });
  }

  private async invoke(params: {
    input: PlannerProviderInput;
    attemptType: ProviderAttemptType;
    userEnvelope: string;
    context?: PlannerProviderRepairContext;
  }): Promise<PlannerProviderOutput> {
    const redactedInput = redactForProvider(params.input, params.input.policy, this.env);
    const redactedEnvelope = redactForProvider(params.userEnvelope, params.input.policy, this.env);
    const repoContext = buildRepoContextEnvelope({ initiative: params.input.initiative });
    const redactedRepoContext = redactForProvider(repoContext, params.input.policy, this.env);
    const plannerToolSchema = JSON.stringify(plannerToolDefinition().input_schema, null, 2);
    const systemPrompt = `${PLANNER_SYSTEM_PROMPT}\n\nRepository context:\n${renderRepoContext(
      redactedRepoContext.redacted as RepoContextEnvelope,
    )}\n\nTaskGraph JSON schema:\n${plannerToolSchema}\n\nReturn only a JSON TaskGraph; do not explain.`;
    const prompt = redactedEnvelope.redacted;
    const env = buildRunnerEnv({ sourceEnv: this.env, policy: params.input.policy.commandProfiles.default });
    const invocation: ClaudeCodeCliInvocation = {
      binary: this.binary,
      ...(this.cwd ? { cwd: this.cwd } : {}),
      ...(this.model ? { model: this.model } : {}),
      prompt,
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
          ? `claude-code-cli planner request timed out after ${this.timeoutMs}ms`
          : formatCliFailure("claude-code-cli planner", result),
        retryable: result.timedOut,
      });
    }

    const text = extractCliResultText(result.parsed, result.stdout);
    const taskGraph = extractTextJson(text);

    if (taskGraph === null) {
      throw providerError({
        code: "provider_schema_invalid",
        message: "claude-code-cli planner did not return parseable JSON",
        retryable: false,
      });
    }

    const usage = normalizeUsageFromCli(result.parsed);
    const attemptArtifact: RedactedInvocationArtifact = {
      attemptType: params.attemptType,
      promptVersion: PLANNER_PROMPT_VERSION,
      model: this.model ?? "default",
      binary: this.binary,
      args: result.args,
      prompt,
      systemPrompt,
      redaction: mergeRedactionSummaries(redactedInput.summary, redactedEnvelope.summary, redactedRepoContext.summary),
    };
    const previous = previousAttempts(params.context);
    const cliArtifact = redactForProvider(result.parsed ?? result.stdout, params.input.policy, this.env);
    const redactedStdout = redactForProvider(result.stdout, params.input.policy, this.env).redacted;
    const redactedStderr = redactForProvider(result.stderr, params.input.policy, this.env).redacted;
    const providerArtifacts: PlannerProviderArtifacts = {
      plannerInput: {
        promptVersion: PLANNER_PROMPT_VERSION,
        accessMode: "claude-code-cli",
        model: this.model ?? "default",
        redactedInput: redactedInput.redacted,
        repoContext: redactedRepoContext.redacted,
        attempts: [...previous, attemptArtifact],
      },
      plannerOutput: {
        promptVersion: PLANNER_PROMPT_VERSION,
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
        taskGraph,
      },
    };

    return {
      providerName: this.name,
      taskGraph,
      modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      cost: {
        estimatedUsd: usage.estimatedCostUsd ?? 0,
        currency: "USD",
      },
      providerArtifacts,
    };
  }
}
