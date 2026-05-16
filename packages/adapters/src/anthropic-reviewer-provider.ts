import { ContractValues, KiwiPolicy } from "@kiwi/contracts";
import {
  ANTHROPIC_MESSAGES_ENDPOINT,
  ANTHROPIC_VERSION,
  AnthropicHttpRequest,
  AnthropicHttpResponse,
  AnthropicMessageRequest as AnthropicMessageRequestBase,
  apiKeyFromAnthropicEnv,
  assertAnthropicOk,
  createAnthropicTransport,
  estimateAnthropicCostUsd,
  extractAnthropicUsage,
  extractTextJson,
  isRecord,
} from "./anthropic-common";
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

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 120_000;

type AnthropicMessageRequest = AnthropicMessageRequestBase<ReturnType<typeof reviewerToolDefinition>>;

export type AnthropicReviewerHttpRequest = AnthropicHttpRequest<AnthropicMessageRequest>;
export type AnthropicReviewerHttpResponse = AnthropicHttpResponse;
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
      providerPreference: {},
      stepTypeOverrides: {},
    },
    riskZones: { high: [] },
    approvals: { requireFor: [], commandApprovalStates: {} },
    commandProfiles: {},
  };
}

function buildRequest(params: { model: string; maxTokens: number; userEnvelope: string }): AnthropicMessageRequest {
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
        text: `Prompt version: ${REVIEWER_PROMPT_VERSION}`,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: `ReviewVerdict tool schema is provided in the cached tools block. Always return the final verdict through ${REVIEWER_TOOL_NAME}.`,
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

const defaultTransport = createAnthropicTransport<AnthropicMessageRequest, ReviewerProviderError>(
  "review",
  providerError,
);

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
    if (!isRecord(block)) {
      continue;
    }
    if (block.type === "tool_use" && block.name === REVIEWER_TOOL_NAME) {
      return block.input;
    }
    if (block.type === "text" && typeof block.text === "string") {
      textBlocks.push(block.text);
    }
  }

  const parsedText = extractTextJson(textBlocks.join("\n"));

  if (parsedText !== null) {
    return parsedText;
  }

  throw providerError({
    code: "provider_schema_invalid",
    message: `Anthropic reviewer response did not call ${REVIEWER_TOOL_NAME}`,
    retryable: false,
  });
}

function previousAttempts(context?: ReviewerProviderRepairContext): AnthropicReviewerAttemptArtifact[] {
  const artifact = context?.invalidProviderArtifacts?.reviewerInput;

  if (!isRecord(artifact) || !Array.isArray(artifact.attempts)) {
    return [];
  }

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
    this.apiKey = options.apiKey ?? apiKeyFromAnthropicEnv(this.env);
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

  async repair(input: ReviewerProviderInput, context: ReviewerProviderRepairContext): Promise<ReviewerProviderOutput> {
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
    assertAnthropicOk(response, providerError);

    const usage = extractAnthropicUsage(response.body);
    const reviewVerdict = extractReviewVerdict(response.body);

    return {
      providerName: this.name,
      reviewVerdict,
      modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      cost: { estimatedUsd: estimateAnthropicCostUsd(this.model, usage), currency: "USD" },
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
