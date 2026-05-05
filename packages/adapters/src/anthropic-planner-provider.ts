import { existsSync, readdirSync, statSync } from "fs";
import path from "path";
import {
  PlannerProvider,
  PlannerProviderArtifacts,
  PlannerProviderInput,
  PlannerProviderOutput,
  PlannerProviderRepairContext,
  PlannerProviderError,
  PlannerProviderErrorCode,
  PlannerProviderSchedulerErrorCodes,
} from "./planner-provider";
import { redactForProvider, RedactionSummary } from "./provider-redaction";
import {
  buildPlannerRepairEnvelope,
  buildPlannerUserEnvelope,
  plannerToolDefinition,
  PLANNER_PROMPT_VERSION,
  PLANNER_SYSTEM_PROMPT,
  PLANNER_TOOL_NAME,
} from "./prompts/planner/v1";

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-4-6";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 120_000;

type AnthropicRole = "user";

interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
  };
}

interface AnthropicMessage {
  role: AnthropicRole;
  content: AnthropicTextBlock[];
}

interface AnthropicMessageRequest {
  model: string;
  max_tokens: number;
  system: AnthropicTextBlock[];
  tools: ReturnType<typeof plannerToolDefinition>[];
  tool_choice: {
    type: "tool";
    name: string;
  };
  messages: AnthropicMessage[];
}

export interface AnthropicPlannerHttpRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: AnthropicMessageRequest;
  timeoutMs: number;
}

export interface AnthropicPlannerHttpResponse {
  ok: boolean;
  status: number;
  body: unknown;
  requestId?: string;
}

export type AnthropicPlannerTransport = (request: AnthropicPlannerHttpRequest) => Promise<AnthropicPlannerHttpResponse>;

export interface AnthropicPlannerProviderOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  maxTokens?: number;
  timeoutMs?: number;
  maxRepairAttempts?: number;
  transport?: AnthropicPlannerTransport;
  env?: Record<string, string | undefined>;
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
  redactedInput: PlannerProviderInput;
  redaction: RedactionSummary;
}

interface AnthropicPlannerAttemptArtifact {
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
  code: PlannerProviderErrorCode;
  message: string;
  retryable: boolean;
  statusCode?: number;
  cause?: unknown;
}): PlannerProviderError {
  const schedulerErrorCode =
    params.code === "provider_rate_limited"
      ? PlannerProviderSchedulerErrorCodes.ProviderRateLimited
      : params.code === "provider_timeout"
        ? PlannerProviderSchedulerErrorCodes.ProviderTimeout
        : params.code === "provider_schema_invalid"
          ? PlannerProviderSchedulerErrorCodes.ProviderSchemaInvalid
          : params.code === "provider_content_policy"
            ? PlannerProviderSchedulerErrorCodes.ProviderContentPolicy
            : params.code === "provider_auth"
              ? PlannerProviderSchedulerErrorCodes.ProviderAuth
              : PlannerProviderSchedulerErrorCodes.ProviderNetwork;

  return new PlannerProviderError({
    code: params.code,
    schedulerErrorCode,
    message: params.message,
    retryable: params.retryable,
    ...(params.statusCode !== undefined ? { statusCode: params.statusCode } : {}),
    ...(params.cause !== undefined ? { cause: params.cause } : {}),
  });
}

function repoSkeleton(repoPath: string): string {
  if (!existsSync(repoPath)) {
    return JSON.stringify({ repoPath, status: "missing" }, null, 2);
  }

  const ignored = new Set([".git", ".kiwi", "node_modules", "dist", "build", "coverage", ".turbo"]);
  const entries: string[] = [];
  const visit = (directory: string, depth: number): void => {
    if (depth > 2 || entries.length >= 200) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(repoPath, absolute);
      entries.push(entry.isDirectory() ? `${relative}/` : relative);
      if (entry.isDirectory()) visit(absolute, depth + 1);
      if (entries.length >= 200) return;
    }
  };

  try {
    const stats = statSync(repoPath);
    if (!stats.isDirectory()) return JSON.stringify({ repoPath, status: "not_directory" }, null, 2);
    visit(repoPath, 0);
    return JSON.stringify(
      {
        repoPath,
        capturedAt: stats.mtime.toISOString(),
        maxDepth: 2,
        maxEntries: 200,
        entries,
      },
      null,
      2,
    );
  } catch (error) {
    return JSON.stringify(
      {
        repoPath,
        status: "unreadable",
        reason: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    );
  }
}

function buildRequest(params: {
  input: PlannerProviderInput;
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
        text: PLANNER_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: `TaskGraph tool schema is provided in the cached tools block. Prompt version: ${PLANNER_PROMPT_VERSION}`,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: `Repository skeleton:\n${repoSkeleton(params.input.initiative.repoPath)}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [plannerToolDefinition()],
    tool_choice: {
      type: "tool",
      name: PLANNER_TOOL_NAME,
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: params.userEnvelope,
          },
        ],
      },
    ],
  };
}

function buildPrompt(params: {
  input: PlannerProviderInput;
  model: string;
  maxTokens: number;
  userEnvelope: string;
  env: Record<string, string | undefined>;
}): PromptBuildResult {
  const redactedInput = redactForProvider(params.input, params.input.policy, params.env);
  const request = buildRequest({
    input: redactedInput.redacted,
    model: params.model,
    maxTokens: params.maxTokens,
    userEnvelope: params.userEnvelope,
  });
  const redactedRequest = redactForProvider(request, params.input.policy, params.env);

  return {
    request: redactedRequest.redacted,
    redactedInput: redactedInput.redacted,
    redaction: {
      secretEnvNames: redactedInput.summary.secretEnvNames,
      envSecretValuesRedacted:
        redactedInput.summary.envSecretValuesRedacted + redactedRequest.summary.envSecretValuesRedacted,
      detectedPatterns: [
        ...new Set([...redactedInput.summary.detectedPatterns, ...redactedRequest.summary.detectedPatterns]),
      ].sort(),
    },
  };
}

async function defaultTransport(request: AnthropicPlannerHttpRequest): Promise<AnthropicPlannerHttpResponse> {
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
        message: `Anthropic planner request timed out after ${request.timeoutMs}ms`,
        retryable: true,
        cause: error,
      });
    }
    throw providerError({
      code: "provider_network",
      message: `Anthropic planner network request failed: ${error instanceof Error ? error.message : String(error)}`,
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

function assertAnthropicOk(response: AnthropicPlannerHttpResponse): void {
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
  return { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };
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

function extractTaskGraph(responseBody: unknown): unknown {
  if (!isRecord(responseBody) || !Array.isArray(responseBody.content)) {
    throw providerError({
      code: "provider_schema_invalid",
      message: "Anthropic planner response did not include content blocks",
      retryable: false,
    });
  }

  const textBlocks: string[] = [];
  for (const block of responseBody.content) {
    if (!isRecord(block)) continue;
    if (block.type === "tool_use" && block.name === PLANNER_TOOL_NAME) {
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
    message: `Anthropic planner response did not call ${PLANNER_TOOL_NAME}`,
    retryable: false,
  });
}

function previousAttempts(context?: PlannerProviderRepairContext): AnthropicPlannerAttemptArtifact[] {
  const artifact = context?.invalidProviderArtifacts?.plannerInput;
  if (!isRecord(artifact) || !Array.isArray(artifact.attempts)) return [];
  return artifact.attempts.filter((entry): entry is AnthropicPlannerAttemptArtifact => isRecord(entry));
}

function buildProviderArtifacts(params: {
  attemptType: "initial" | "repair";
  model: string;
  prompt: PromptBuildResult;
  response: unknown;
  taskGraph: unknown;
  context?: PlannerProviderRepairContext;
  env: Record<string, string | undefined>;
}): PlannerProviderArtifacts {
  const response = redactForProvider(params.response, params.prompt.redactedInput.policy, params.env);
  const attempts = [
    ...previousAttempts(params.context),
    {
      attemptType: params.attemptType,
      promptVersion: PLANNER_PROMPT_VERSION,
      model: params.model,
      request: params.prompt.request,
      redaction: params.prompt.redaction,
    },
  ];

  return {
    plannerInput: {
      promptVersion: PLANNER_PROMPT_VERSION,
      model: params.model,
      redactedInput: params.prompt.redactedInput,
      attempts,
    },
    plannerOutput: {
      promptVersion: PLANNER_PROMPT_VERSION,
      model: params.model,
      response: response.redacted,
      taskGraph: params.taskGraph,
    },
  };
}

export class AnthropicPlannerProvider implements PlannerProvider {
  readonly name: string;
  readonly maxRepairAttempts: number;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly transport: AnthropicPlannerTransport;
  private readonly env: Record<string, string | undefined>;

  constructor(options: AnthropicPlannerProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.apiKey = options.apiKey ?? apiKeyFromEnv(this.env);
    this.model = options.model ?? DEFAULT_MODEL;
    this.name = `anthropic:${this.model}`;
    this.endpoint = options.endpoint ?? ANTHROPIC_MESSAGES_ENDPOINT;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRepairAttempts = options.maxRepairAttempts ?? 1;
    this.transport = options.transport ?? defaultTransport;
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
    if (!this.apiKey) {
      throw providerError({
        code: "provider_auth",
        message: "ANTHROPIC_API_KEY is required for AnthropicPlannerProvider",
        retryable: false,
      });
    }

    const prompt = buildPrompt({
      input: params.input,
      model: this.model,
      maxTokens: this.maxTokens,
      userEnvelope: params.userEnvelope,
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
    const taskGraph = extractTaskGraph(response.body);
    return {
      providerName: this.name,
      taskGraph,
      modelUsage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
      cost: {
        estimatedUsd: estimateCostUsd(this.model, usage),
        currency: "USD",
      },
      providerArtifacts: buildProviderArtifacts({
        attemptType: params.attemptType,
        model: this.model,
        prompt,
        response: response.body,
        taskGraph,
        ...(params.context ? { context: params.context } : {}),
        env: this.env,
      }),
    };
  }
}
