import { ContractValues, KiwiPolicy } from "@kiwi/contracts";
import { redactForProvider, RedactionSummary } from "./provider-redaction";
import {
  buildReviewerRepairEnvelope,
  buildReviewerUserEnvelope,
  reviewerToolDefinition,
  REVIEWER_PROMPT_VERSION,
  REVIEWER_SYSTEM_PROMPT,
  REVIEWER_TOOL_NAME,
} from "./prompts/reviewer/v1";
import {
  ReviewerProvider,
  ReviewerProviderArtifacts,
  ReviewerProviderError,
  ReviewerProviderErrorCode,
  ReviewerProviderInput,
  ReviewerProviderOutput,
  ReviewerProviderRepairContext,
  ReviewerProviderSchedulerErrorCodes,
} from "./reviewer-provider";

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 120_000;

interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
  };
}

interface AnthropicMessage {
  role: "user";
  content: AnthropicTextBlock[];
}

interface AnthropicMessageRequest {
  model: string;
  max_tokens: number;
  system: AnthropicTextBlock[];
  tools: ReturnType<typeof reviewerToolDefinition>[];
  tool_choice: { type: "tool"; name: string };
  messages: AnthropicMessage[];
}

export interface AnthropicReviewerHttpRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: AnthropicMessageRequest;
  timeoutMs: number;
}

export interface AnthropicReviewerHttpResponse {
  ok: boolean;
  status: number;
  body: unknown;
  requestId?: string;
}

export type AnthropicReviewerTransport = (
  request: AnthropicReviewerHttpRequest,
) => Promise<AnthropicReviewerHttpResponse>;

export interface AnthropicReviewerProviderOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  maxTokens?: number;
  timeoutMs?: number;
  maxRepairAttempts?: number;
  transport?: AnthropicReviewerTransport;
  env?: Record<string, string | undefined>;
  policy?: KiwiPolicy;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  baseInputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

interface PricePerMillionTokens {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

interface PromptBuildResult {
  request: AnthropicMessageRequest;
  redaction: RedactionSummary;
}

interface AnthropicReviewerAttemptArtifact {
  attemptType: "initial" | "repair";
  promptVersion: string;
  model: string;
  request: AnthropicMessageRequest;
  redaction: RedactionSummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function apiKeyFromEnv(env: Record<string, string | undefined>): string | undefined {
  return env.ANTHROPIC_API_KEY;
}

function providerError(params: {
  code: ReviewerProviderErrorCode;
  message: string;
  retryable: boolean;
  statusCode?: number;
  cause?: unknown;
}): ReviewerProviderError {
  const schedulerErrorCode =
    params.code === "provider_rate_limited"
      ? ReviewerProviderSchedulerErrorCodes.ProviderRateLimited
      : params.code === "provider_timeout"
        ? ReviewerProviderSchedulerErrorCodes.ProviderTimeout
        : params.code === "provider_schema_invalid"
          ? ReviewerProviderSchedulerErrorCodes.ProviderSchemaInvalid
          : params.code === "provider_content_policy"
            ? ReviewerProviderSchedulerErrorCodes.ProviderContentPolicy
            : params.code === "provider_auth"
              ? ReviewerProviderSchedulerErrorCodes.ProviderAuth
              : ReviewerProviderSchedulerErrorCodes.ProviderNetwork;

  return new ReviewerProviderError({
    code: params.code,
    schedulerErrorCode,
    message: params.message,
    retryable: params.retryable,
    ...(params.statusCode !== undefined ? { statusCode: params.statusCode } : {}),
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

function buildRequest(params: {
  model: string;
  maxTokens: number;
  userEnvelope: string;
}): AnthropicMessageRequest {
  return {
    model: params.model,
    max_tokens: params.maxTokens,
    system: [
      {
        type: "text",
        text: REVIEWER_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: `ReviewVerdict tool schema is provided in the cached tools block. Prompt version: ${REVIEWER_PROMPT_VERSION}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [reviewerToolDefinition()],
    tool_choice: { type: "tool", name: REVIEWER_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: params.userEnvelope }],
      },
    ],
  };
}

function buildPrompt(params: {
  model: string;
  maxTokens: number;
  userEnvelope: string;
  policy: KiwiPolicy;
  env: Record<string, string | undefined>;
}): PromptBuildResult {
  const baseRequest = buildRequest({
    model: params.model,
    maxTokens: params.maxTokens,
    userEnvelope: params.userEnvelope,
  });
  const redacted = redactForProvider(baseRequest, params.policy, params.env);
  return { request: redacted.redacted, redaction: redacted.summary };
}

async function defaultTransport(request: AnthropicReviewerHttpRequest): Promise<AnthropicReviewerHttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as unknown;
    const requestId = response.headers.get("request-id") ?? undefined;
    return {
      ok: response.ok,
      status: response.status,
      body,
      ...(requestId ? { requestId } : {}),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw providerError({
        code: "provider_timeout",
        message: `Anthropic reviewer request timed out after ${request.timeoutMs}ms`,
        retryable: true,
        cause: error,
      });
    }
    throw providerError({
      code: "provider_network",
      message: `Anthropic reviewer network request failed: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function responseErrorMessage(body: unknown): string {
  if (!isRecord(body)) return "Anthropic API request failed";
  const error = isRecord(body.error) ? body.error : body;
  const type = typeof error.type === "string" ? error.type : "unknown";
  const message = typeof error.message === "string" ? error.message : "Anthropic API request failed";
  return `${type}: ${message}`;
}

function responseErrorType(body: unknown): string {
  if (!isRecord(body)) return "";
  const error = isRecord(body.error) ? body.error : body;
  return typeof error.type === "string" ? error.type.toLowerCase() : "";
}

function assertAnthropicOk(response: AnthropicReviewerHttpResponse): void {
  if (response.ok) return;
  const message = responseErrorMessage(response.body);
  const errorType = responseErrorType(response.body);
  if (response.status === 401 || response.status === 403) {
    throw providerError({ code: "provider_auth", message, retryable: false, statusCode: response.status });
  }
  if (response.status === 429) {
    throw providerError({ code: "provider_rate_limited", message, retryable: true, statusCode: response.status });
  }
  if (response.status === 408 || response.status === 504) {
    throw providerError({ code: "provider_timeout", message, retryable: true, statusCode: response.status });
  }
  if (
    errorType.includes("content_policy") ||
    errorType.includes("safety") ||
    message.toLowerCase().includes("content policy")
  ) {
    throw providerError({ code: "provider_content_policy", message, retryable: false, statusCode: response.status });
  }
  throw providerError({
    code: "provider_network",
    message,
    retryable: response.status >= 500,
    statusCode: response.status,
  });
}

function extractUsage(responseBody: unknown): NormalizedUsage {
  const usage = isRecord(responseBody) && isRecord(responseBody.usage) ? (responseBody.usage as AnthropicUsage) : {};
  const cacheCreation = isRecord(usage.cache_creation) ? usage.cache_creation : {};
  const cacheWriteTokens =
    numeric(usage.cache_creation_input_tokens) +
    numeric(cacheCreation.ephemeral_5m_input_tokens) +
    numeric(cacheCreation.ephemeral_1h_input_tokens);
  const cacheReadTokens = numeric(usage.cache_read_input_tokens);
  const baseInputTokens = numeric(usage.input_tokens);
  const outputTokens = numeric(usage.output_tokens);
  return {
    inputTokens: baseInputTokens + cacheWriteTokens + cacheReadTokens,
    outputTokens,
    baseInputTokens,
    cacheWriteTokens,
    cacheReadTokens,
  };
}

function priceForModel(model: string): PricePerMillionTokens {
  if (model.includes("opus-4-6") || model.includes("opus-4-7") || model.includes("opus-4-5")) {
    return { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };
  }
  if (model.includes("sonnet")) {
    return { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
  }
  if (model.includes("haiku-4-5")) {
    return { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 };
  }
  if (model.includes("haiku")) {
    return { input: 0.25, output: 1.25, cacheWrite: 0.3, cacheRead: 0.03 };
  }
  return { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
}

function estimateCostUsd(model: string, usage: NormalizedUsage): number {
  const price = priceForModel(model);
  const cost =
    (usage.baseInputTokens * price.input +
      usage.cacheWriteTokens * price.cacheWrite +
      usage.cacheReadTokens * price.cacheRead +
      usage.outputTokens * price.output) /
    1_000_000;
  return Number(cost.toFixed(8));
}

function extractTextJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as unknown;
    } catch {
      return null;
    }
  }
}

function extractReviewVerdict(responseBody: unknown): unknown {
  if (!isRecord(responseBody) || !Array.isArray(responseBody.content)) {
    throw providerError({
      code: "provider_schema_invalid",
      message: "Anthropic reviewer response did not include content blocks",
      retryable: false,
    });
  }

  const textBlocks: string[] = [];
  for (const block of responseBody.content) {
    if (!isRecord(block)) continue;
    if (block.type === "tool_use" && block.name === REVIEWER_TOOL_NAME) {
      return block.input;
    }
    if (block.type === "text" && typeof block.text === "string") {
      textBlocks.push(block.text);
    }
  }

  const parsedText = extractTextJson(textBlocks.join("\n"));
  if (parsedText !== null) return parsedText;

  throw providerError({
    code: "provider_schema_invalid",
    message: `Anthropic reviewer response did not call ${REVIEWER_TOOL_NAME}`,
    retryable: false,
  });
}

function previousAttempts(context?: ReviewerProviderRepairContext): AnthropicReviewerAttemptArtifact[] {
  const artifact = context?.invalidProviderArtifacts?.reviewerInput;
  if (!isRecord(artifact) || !Array.isArray(artifact.attempts)) return [];
  return artifact.attempts.filter((entry): entry is AnthropicReviewerAttemptArtifact => isRecord(entry));
}

function buildProviderArtifacts(params: {
  attemptType: "initial" | "repair";
  model: string;
  prompt: PromptBuildResult;
  response: unknown;
  reviewVerdict: unknown;
  context?: ReviewerProviderRepairContext;
  policy: KiwiPolicy;
  env: Record<string, string | undefined>;
}): ReviewerProviderArtifacts {
  const response = redactForProvider(params.response, params.policy, params.env);
  const attempts = [
    ...previousAttempts(params.context),
    {
      attemptType: params.attemptType,
      promptVersion: REVIEWER_PROMPT_VERSION,
      model: params.model,
      request: params.prompt.request,
      redaction: params.prompt.redaction,
    },
  ];
  return {
    reviewerInput: {
      promptVersion: REVIEWER_PROMPT_VERSION,
      model: params.model,
      attempts,
    },
    reviewerOutput: {
      promptVersion: REVIEWER_PROMPT_VERSION,
      model: params.model,
      response: response.redacted,
      reviewVerdict: params.reviewVerdict,
    },
  };
}

export class AnthropicReviewerProvider implements ReviewerProvider {
  readonly name: string;
  readonly maxRepairAttempts: number;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly transport: AnthropicReviewerTransport;
  private readonly env: Record<string, string | undefined>;
  private readonly policy: KiwiPolicy;

  constructor(options: AnthropicReviewerProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.apiKey = options.apiKey ?? apiKeyFromEnv(this.env);
    this.model = options.model ?? DEFAULT_MODEL;
    this.name = `anthropic:${this.model}`;
    this.endpoint = options.endpoint ?? ANTHROPIC_MESSAGES_ENDPOINT;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRepairAttempts = options.maxRepairAttempts ?? 1;
    this.transport = options.transport ?? defaultTransport;
    this.policy = options.policy ?? emptyPolicy();
  }

  async review(input: ReviewerProviderInput): Promise<ReviewerProviderOutput> {
    return this.invoke({
      input,
      attemptType: "initial",
      userEnvelope: buildReviewerUserEnvelope(input),
    });
  }

  async repair(
    input: ReviewerProviderInput,
    context: ReviewerProviderRepairContext,
  ): Promise<ReviewerProviderOutput> {
    return this.invoke({
      input,
      attemptType: "repair",
      userEnvelope: buildReviewerRepairEnvelope({
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
    userEnvelope: string;
    context?: ReviewerProviderRepairContext;
  }): Promise<ReviewerProviderOutput> {
    if (!this.apiKey) {
      throw providerError({
        code: "provider_auth",
        message: "ANTHROPIC_API_KEY is required for AnthropicReviewerProvider",
        retryable: false,
      });
    }

    const prompt = buildPrompt({
      model: this.model,
      maxTokens: this.maxTokens,
      userEnvelope: params.userEnvelope,
      policy: this.policy,
      env: this.env,
    });
    const response = await this.transport({
      endpoint: this.endpoint,
      timeoutMs: this.timeoutMs,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: prompt.request,
    });
    assertAnthropicOk(response);

    const usage = extractUsage(response.body);
    const reviewVerdict = extractReviewVerdict(response.body);
    return {
      providerName: this.name,
      reviewVerdict,
      modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      cost: { estimatedUsd: estimateCostUsd(this.model, usage), currency: "USD" },
      providerArtifacts: buildProviderArtifacts({
        attemptType: params.attemptType,
        model: this.model,
        prompt,
        response: response.body,
        reviewVerdict,
        ...(params.context ? { context: params.context } : {}),
        policy: this.policy,
        env: this.env,
      }),
    };
  }
}
