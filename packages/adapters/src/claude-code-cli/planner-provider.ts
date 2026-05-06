import { extractTextJson } from "../anthropic-common";
import {
  ClaudeCodeCliInvocation,
  ClaudeCodeCliRunner,
  DefaultClaudeCodeCliRunner,
  extractCliResultText,
  normalizeUsageFromCli,
} from "./client";
import {
  PlannerProvider,
  PlannerProviderArtifacts,
  PlannerProviderError,
  PlannerProviderErrorCode,
  PlannerProviderInput,
  PlannerProviderOutput,
  PlannerProviderRepairContext,
  PlannerProviderSchedulerErrorCodes,
} from "../planner-provider";
import { redactForProvider, RedactionSummary } from "../provider-redaction";
import { buildRunnerEnv } from "../runner-env";
import {
  buildPlannerRepairEnvelope,
  buildPlannerUserEnvelope,
  plannerToolDefinition,
  PLANNER_PROMPT_VERSION,
  PLANNER_SYSTEM_PROMPT,
} from "../prompts/planner/v1";

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
  if (!isRecord(artifact) || !Array.isArray(artifact.attempts)) return [];
  return artifact.attempts.filter((entry): entry is Record<string, unknown> => isRecord(entry));
}

interface RedactedInvocationArtifact {
  attemptType: "initial" | "repair";
  promptVersion: string;
  model: string;
  binary: string;
  args: string[];
  prompt: string;
  systemPrompt: string;
  redaction: RedactionSummary;
}

export class ClaudeCodeCliPlannerProvider implements PlannerProvider {
  readonly name: string;
  readonly maxRepairAttempts: number;
  private readonly binary: string;
  private readonly cwd: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly runner: ClaudeCodeCliRunner;
  private readonly env: Record<string, string | undefined>;

  constructor(options: ClaudeCodeCliPlannerProviderOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CLAUDE_CODE_BINARY ?? "claude";
    if (options.cwd !== undefined) this.cwd = options.cwd;
    this.model = options.model ?? "claude-opus-4-6";
    this.name = `claude-code-cli:${this.model}`;
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
    attemptType: "initial" | "repair";
    userEnvelope: string;
    context?: PlannerProviderRepairContext;
  }): Promise<PlannerProviderOutput> {
    const redactedInput = redactForProvider(params.input, params.input.policy, this.env);
    const redactedEnvelope = redactForProvider(params.userEnvelope, params.input.policy, this.env);
    const plannerToolSchema = JSON.stringify(plannerToolDefinition().input_schema, null, 2);
    const systemPrompt = `${PLANNER_SYSTEM_PROMPT}\n\nTaskGraph JSON schema:\n${plannerToolSchema}\n\nReturn only a JSON TaskGraph; do not explain.`;
    const prompt = redactedEnvelope.redacted;
    const env = buildRunnerEnv({ sourceEnv: this.env, policy: params.input.policy.commandProfiles.default });
    const invocation: ClaudeCodeCliInvocation = {
      binary: this.binary,
      ...(this.cwd ? { cwd: this.cwd } : {}),
      model: this.model,
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
          : `claude-code-cli planner exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`,
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
      model: this.model,
      binary: this.binary,
      args: result.args,
      prompt,
      systemPrompt,
      redaction: redactedEnvelope.summary,
    };
    const previous = previousAttempts(params.context);
    const cliArtifact = redactForProvider(result.parsed ?? result.stdout, params.input.policy, this.env);
    const redactedStdout = redactForProvider(result.stdout, params.input.policy, this.env).redacted;
    const redactedStderr = redactForProvider(result.stderr, params.input.policy, this.env).redacted;
    const providerArtifacts: PlannerProviderArtifacts = {
      plannerInput: {
        promptVersion: PLANNER_PROMPT_VERSION,
        accessMode: "claude-code-cli",
        model: this.model,
        redactedInput: redactedInput.redacted,
        attempts: [...previous, attemptArtifact],
      },
      plannerOutput: {
        promptVersion: PLANNER_PROMPT_VERSION,
        accessMode: "claude-code-cli",
        model: this.model,
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
