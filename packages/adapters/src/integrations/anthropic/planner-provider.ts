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
} from "./common.js";
import type { ProviderAttemptType } from "../../constants.js";
import {
  PlannerProvider,
  PlannerProviderArtifacts,
  PlannerProviderInput,
  PlannerProviderOutput,
  PlannerProviderRepairContext,
  PlannerProviderError,
  PlannerProviderErrorCode,
  PlannerProviderSchedulerErrorCodes,
} from "../../providers/planner.js";
import { redactForProvider, RedactionSummary } from "../../providers/redaction.js";
import { buildRepoContextEnvelope, RepoContextEnvelope, renderRepoContext } from "../../providers/repo-context.js";
import {
  buildPlannerRepairEnvelope,
  buildPlannerUserEnvelope,
  plannerToolDefinition,
  PLANNER_PROMPT_VERSION,
  PLANNER_SYSTEM_PROMPT,
  PLANNER_TOOL_NAME,
} from "../../prompts/planner-v1/index.js";

const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 120_000;

type AnthropicMessageRequest = AnthropicMessageRequestBase<ReturnType<typeof plannerToolDefinition>>;

export type AnthropicPlannerHttpRequest = AnthropicHttpRequest<AnthropicMessageRequest>;
export type AnthropicPlannerHttpResponse = AnthropicHttpResponse;
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

interface PromptBuildResult {
  request: AnthropicMessageRequest;
  redactedInput: PlannerProviderInput;
  repoContext: RepoContextEnvelope;
  redaction: RedactionSummary;
}

interface AnthropicPlannerAttemptArtifact {
  attemptType: ProviderAttemptType;
  promptVersion: string;
  model: string;
  request: AnthropicMessageRequest;
  redaction: RedactionSummary;
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

function buildRequest(params: {
  input: PlannerProviderInput;
  model: string;
  maxTokens: number;
  userEnvelope: string;
  repoContext: RepoContextEnvelope;
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
        text: `Repository context:\n${renderRepoContext(params.repoContext)}`,
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
  const repoContext = buildRepoContextEnvelope({ initiative: params.input.initiative });
  const redactedInput = redactForProvider(params.input, params.input.policy, params.env);
  const redactedRepoContext = redactForProvider(repoContext, params.input.policy, params.env);
  const request = buildRequest({
    input: redactedInput.redacted,
    model: params.model,
    maxTokens: params.maxTokens,
    userEnvelope: params.userEnvelope,
    repoContext: redactedRepoContext.redacted,
  });
  const redactedRequest = redactForProvider(request, params.input.policy, params.env);

  return {
    request: redactedRequest.redacted,
    redactedInput: redactedInput.redacted,
    repoContext: redactedRepoContext.redacted,
    redaction: {
      secretEnvNames: redactedInput.summary.secretEnvNames,
      envSecretValuesRedacted:
        redactedInput.summary.envSecretValuesRedacted +
        redactedRepoContext.summary.envSecretValuesRedacted +
        redactedRequest.summary.envSecretValuesRedacted,
      detectedPatterns: [
        ...new Set([
          ...redactedInput.summary.detectedPatterns,
          ...redactedRepoContext.summary.detectedPatterns,
          ...redactedRequest.summary.detectedPatterns,
        ]),
      ].sort(),
    },
  };
}

const defaultTransport = createAnthropicTransport<AnthropicMessageRequest, PlannerProviderError>(
  "planning",
  providerError,
);

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
    if (!isRecord(block)) {
      continue;
    }
    if (block.type === "tool_use" && block.name === PLANNER_TOOL_NAME) {
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
    message: `Anthropic planner response did not call ${PLANNER_TOOL_NAME}`,
    retryable: false,
  });
}

function previousAttempts(context?: PlannerProviderRepairContext): AnthropicPlannerAttemptArtifact[] {
  const artifact = context?.invalidProviderArtifacts?.plannerInput;

  if (!isRecord(artifact) || !Array.isArray(artifact.attempts)) {
    return [];
  }

  return artifact.attempts.filter((entry): entry is AnthropicPlannerAttemptArtifact => isRecord(entry));
}

function buildProviderArtifacts(params: {
  attemptType: ProviderAttemptType;
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
      repoContext: params.prompt.repoContext,
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
    this.apiKey = options.apiKey ?? apiKeyFromAnthropicEnv(this.env);
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
    attemptType: ProviderAttemptType;
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
    assertAnthropicOk(response, providerError);

    const usage = extractAnthropicUsage(response.body);
    const taskGraph = extractTaskGraph(response.body);

    return {
      providerName: this.name,
      taskGraph,
      modelUsage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
      cost: {
        estimatedUsd: estimateAnthropicCostUsd(this.model, usage),
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
