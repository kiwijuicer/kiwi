export const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
  };
}

export interface AnthropicMessage {
  role: "user";
  content: AnthropicTextBlock[];
}

export interface AnthropicMessageRequest<TToolDefinition = unknown> {
  model: string;
  max_tokens: number;
  system: AnthropicTextBlock[];
  tools: TToolDefinition[];
  tool_choice: { type: "tool"; name: string };
  messages: AnthropicMessage[];
}

export interface AnthropicHttpRequest<TBody = unknown> {
  endpoint: string;
  headers: Record<string, string>;
  body: TBody;
  timeoutMs: number;
}

export interface AnthropicHttpResponse {
  ok: boolean;
  status: number;
  body: unknown;
  requestId?: string;
}

type AnthropicProviderErrorCode =
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_network"
  | "provider_schema_invalid"
  | "provider_content_policy"
  | "provider_auth";

type AnthropicProviderErrorFactory<TError extends Error> = (params: {
  code: AnthropicProviderErrorCode;
  message: string;
  retryable: boolean;
  statusCode?: number;
  cause?: unknown;
}) => TError;

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

interface NormalizedAnthropicUsage {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function apiKeyFromAnthropicEnv(env: Record<string, string | undefined>): string | undefined {
  return env.ANTHROPIC_API_KEY;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function responseErrorMessage(body: unknown): string {
  if (!isRecord(body)) {
    return "Anthropic API request failed";
  }
  const error = isRecord(body.error) ? body.error : body;
  const type = typeof error.type === "string" ? error.type : "unknown";
  const message = typeof error.message === "string" ? error.message : "Anthropic API request failed";

  return `${type}: ${message}`;
}

function responseErrorType(body: unknown): string {
  if (!isRecord(body)) {
    return "";
  }
  const error = isRecord(body.error) ? body.error : body;

  return typeof error.type === "string" ? error.type.toLowerCase() : "";
}

export function createAnthropicTransport<TBody, TError extends Error>(
  label: string,
  providerError: AnthropicProviderErrorFactory<TError>,
): (request: AnthropicHttpRequest<TBody>) => Promise<AnthropicHttpResponse> {
  return async (request) => {
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
          message: `Anthropic ${label} request timed out after ${request.timeoutMs}ms`,
          retryable: true,
          cause: error,
        });
      }
      throw providerError({
        code: "provider_network",
        message: `Anthropic ${label} network request failed: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function assertAnthropicOk<TError extends Error>(
  response: AnthropicHttpResponse,
  providerError: AnthropicProviderErrorFactory<TError>,
): void {
  if (response.ok) {
    return;
  }

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

export function extractAnthropicUsage(responseBody: unknown): NormalizedAnthropicUsage {
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

export function estimateAnthropicCostUsd(model: string, usage: NormalizedAnthropicUsage): number {
  const price = priceForModel(model);
  const cost =
    (usage.baseInputTokens * price.input +
      usage.cacheWriteTokens * price.cacheWrite +
      usage.cacheReadTokens * price.cacheRead +
      usage.outputTokens * price.output) /
    1_000_000;

  return Number(cost.toFixed(8));
}

export function extractTextJson(text: string): unknown | null {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]) as unknown;
    } catch {
      return null;
    }
  }
}
