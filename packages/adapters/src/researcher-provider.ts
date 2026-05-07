import { ContractValues, ResearchReport, ResearchReportSchema, Initiative, KiwiPolicy } from "@kiwi/contracts";
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
import {
  ClaudeCodeCliInvocation,
  ClaudeCodeCliRunner,
  DefaultClaudeCodeCliRunner,
  extractCliResultText,
  formatCliFailure,
  normalizeUsageFromCli,
} from "./claude-code-cli/client";
import { redactForProvider } from "./provider-redaction";
import { buildRepoContextEnvelope } from "./repo-context";
import { buildRunnerEnv } from "./runner-env";

const RESEARCHER_TOOL_NAME = "emit_research_report";
export const RESEARCHER_PROMPT_VERSION = "researcher.v1";
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface ResearcherProviderInput {
  runId: string;
  stepId?: string;
  initiative: Initiative;
  candidateFiles: string[];
  requestedAt: string;
  policy: KiwiPolicy;
}

export interface ResearcherProviderOutput {
  providerName: string;
  researchReport: unknown;
  modelUsage: { inputTokens: number; outputTokens: number };
  cost: { estimatedUsd: number; currency: "USD" };
  providerArtifacts?: {
    researcherInput?: unknown;
    researcherOutput?: unknown;
  };
}

export interface ValidatedResearcherProviderOutput extends ResearcherProviderOutput {
  researchReport: ResearchReport;
  validation: {
    schema: "ResearchReportSchema";
    valid: true;
  };
}

export interface ResearcherProvider {
  readonly name: string;
  research(input: ResearcherProviderInput): Promise<ResearcherProviderOutput>;
}

export class ResearcherProviderError extends Error {
  constructor(
    readonly code:
      | "provider_rate_limited"
      | "provider_timeout"
      | "provider_network"
      | "provider_schema_invalid"
      | "provider_content_policy"
      | "provider_auth",
    message: string,
    readonly retryable: boolean,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ResearcherProviderError";
  }
}

function providerError(params: {
  code: ResearcherProviderError["code"];
  message: string;
  retryable: boolean;
  statusCode?: number;
}): ResearcherProviderError {
  return new ResearcherProviderError(params.code, params.message, params.retryable, params.statusCode);
}

export function researchToolDefinition() {
  return {
    name: RESEARCHER_TOOL_NAME,
    description: "Emit a schema-valid kiwi ResearchReport for the requested Initiative.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "schemaVersion",
        "runId",
        "initiativeId",
        "relevantFiles",
        "symbolsOfInterest",
        "openQuestions",
        "generatedAt",
      ],
      properties: {
        schemaVersion: { type: "string", enum: ["1"] },
        runId: { type: "string", pattern: "^run_[a-z0-9_]+$" },
        initiativeId: { type: "string", pattern: "^init_[a-z0-9_]+$" },
        relevantFiles: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path"],
            properties: {
              path: { type: "string", minLength: 1 },
              reason: { type: "string", minLength: 1 },
            },
          },
        },
        symbolsOfInterest: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name"],
            properties: {
              name: { type: "string", minLength: 1 },
              kind: { type: "string", minLength: 1 },
              filePath: { type: "string", minLength: 1 },
            },
          },
        },
        openQuestions: { type: "array", items: { type: "string", minLength: 1 } },
        summary: { type: "string", minLength: 1 },
        generatedAt: { type: "string", format: "date-time" },
      },
    },
    cache_control: { type: "ephemeral" },
  };
}

export function buildResearchEnvelope(input: ResearcherProviderInput): string {
  return JSON.stringify(
    {
      request: "Identify relevant files, symbols of interest, and open questions for this kiwi Initiative.",
      runId: input.runId,
      stepId: input.stepId,
      requestedAt: input.requestedAt,
      initiative: input.initiative,
      candidateFiles: input.candidateFiles,
      repoContext: buildRepoContextEnvelope({ initiative: input.initiative }),
      constraints: [
        "Prefer files present in candidateFiles or repoContext grep hits.",
        "Do not invent files or symbols.",
        "Return only structured JSON matching ResearchReportSchema.",
      ],
    },
    null,
    2,
  );
}

function extractResearchReport(responseBody: unknown): unknown {
  if (!isRecord(responseBody) || !Array.isArray(responseBody.content)) {
    throw providerError({
      code: "provider_schema_invalid",
      message: "Anthropic researcher response did not include content blocks",
      retryable: false,
    });
  }
  const textBlocks: string[] = [];
  for (const block of responseBody.content) {
    if (!isRecord(block)) continue;
    if (block.type === "tool_use" && block.name === RESEARCHER_TOOL_NAME) return block.input;
    if (block.type === "text" && typeof block.text === "string") textBlocks.push(block.text);
  }
  const parsed = extractTextJson(textBlocks.join("\n"));
  if (parsed !== null) return parsed;
  throw providerError({
    code: "provider_schema_invalid",
    message: `Anthropic researcher response did not call ${RESEARCHER_TOOL_NAME}`,
    retryable: false,
  });
}

export async function runResearcherProviderWithRetries(
  provider: ResearcherProvider,
  input: ResearcherProviderInput,
): Promise<ValidatedResearcherProviderOutput> {
  const output = await provider.research(input);
  return {
    ...output,
    researchReport: ResearchReportSchema.parse(output.researchReport),
    validation: { schema: "ResearchReportSchema", valid: true },
  };
}

type AnthropicResearcherMessageRequest = AnthropicMessageRequestBase<ReturnType<typeof researchToolDefinition>>;
export type AnthropicResearcherHttpRequest = AnthropicHttpRequest<AnthropicResearcherMessageRequest>;
export type AnthropicResearcherTransport = (request: AnthropicResearcherHttpRequest) => Promise<AnthropicHttpResponse>;

export interface AnthropicResearcherProviderOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  maxTokens?: number;
  timeoutMs?: number;
  transport?: AnthropicResearcherTransport;
  env?: Record<string, string | undefined>;
}

const defaultTransport = createAnthropicTransport<AnthropicResearcherMessageRequest, ResearcherProviderError>(
  ContractValues.Researcher,
  providerError,
);

export class AnthropicResearcherProvider implements ResearcherProvider {
  readonly name: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly transport: AnthropicResearcherTransport;
  private readonly env: Record<string, string | undefined>;

  constructor(options: AnthropicResearcherProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.apiKey = options.apiKey ?? apiKeyFromAnthropicEnv(this.env);
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.name = `anthropic:${this.model}`;
    this.endpoint = options.endpoint ?? ANTHROPIC_MESSAGES_ENDPOINT;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.transport = options.transport ?? defaultTransport;
  }

  async research(input: ResearcherProviderInput): Promise<ResearcherProviderOutput> {
    if (!this.apiKey) {
      throw providerError({
        code: "provider_auth",
        message: "ANTHROPIC_API_KEY is required for AnthropicResearcherProvider",
        retryable: false,
      });
    }
    const envelope = buildResearchEnvelope(input);
    const redactedEnvelope = redactForProvider(envelope, input.policy, this.env);
    const request: AnthropicResearcherMessageRequest = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: [
        {
          type: "text",
          text: "You are kiwi's researcher agent. Return concise structured repository context only.",
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [researchToolDefinition()],
      tool_choice: { type: "tool", name: RESEARCHER_TOOL_NAME },
      messages: [{ role: "user", content: [{ type: "text", text: redactedEnvelope.redacted }] }],
    };
    const redactedRequest = redactForProvider(request, input.policy, this.env);
    const response = await this.transport({
      endpoint: this.endpoint,
      timeoutMs: this.timeoutMs,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: redactedRequest.redacted,
    });
    assertAnthropicOk(response, providerError);
    const usage = extractAnthropicUsage(response.body);
    const researchReport = extractResearchReport(response.body);
    return {
      providerName: this.name,
      researchReport,
      modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      cost: { estimatedUsd: estimateAnthropicCostUsd(this.model, usage), currency: "USD" },
      providerArtifacts: {
        researcherInput: {
          promptVersion: RESEARCHER_PROMPT_VERSION,
          accessMode: "anthropic-api",
          model: this.model,
          request: redactedRequest.redacted,
          redaction: redactedRequest.summary,
        },
        researcherOutput: {
          promptVersion: RESEARCHER_PROMPT_VERSION,
          accessMode: "anthropic-api",
          model: this.model,
          response: redactForProvider(response.body, input.policy, this.env).redacted,
          researchReport,
        },
      },
    };
  }
}

export interface ClaudeCodeCliResearcherProviderOptions {
  binary?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  runner?: ClaudeCodeCliRunner;
  env?: Record<string, string | undefined>;
}

export class ClaudeCodeCliResearcherProvider implements ResearcherProvider {
  readonly name: string;
  private readonly binary: string;
  private readonly cwd: string | undefined;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly runner: ClaudeCodeCliRunner;
  private readonly env: Record<string, string | undefined>;

  constructor(options: ClaudeCodeCliResearcherProviderOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CLAUDE_CODE_BINARY ?? "claude";
    if (options.cwd !== undefined) this.cwd = options.cwd;
    this.model = options.model;
    this.name = `claude-code-cli:${this.model ?? "default"}`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.runner = options.runner ?? new DefaultClaudeCodeCliRunner();
    this.env = options.env ?? process.env;
  }

  async research(input: ResearcherProviderInput): Promise<ResearcherProviderOutput> {
    const envelope = buildResearchEnvelope(input);
    const redactedEnvelope = redactForProvider(envelope, input.policy, this.env);
    const invocation: ClaudeCodeCliInvocation = {
      binary: this.binary,
      ...(this.cwd ? { cwd: this.cwd } : {}),
      ...(this.model ? { model: this.model } : {}),
      prompt: redactedEnvelope.redacted,
      systemPrompt: "You are kiwi's researcher agent. Return only JSON matching ResearchReportSchema; no commentary.",
      outputFormat: "json",
      timeoutMs: this.timeoutMs,
      env: buildRunnerEnv({ sourceEnv: this.env, policy: input.policy.commandProfiles.default }),
    };
    const result = await this.runner.run(invocation);
    if (!result.ok) {
      throw providerError({
        code: result.timedOut ? "provider_timeout" : "provider_network",
        message: result.timedOut
          ? `claude-code-cli researcher request timed out after ${this.timeoutMs}ms`
          : formatCliFailure("claude-code-cli researcher", result),
        retryable: result.timedOut,
      });
    }
    const text = extractCliResultText(result.parsed, result.stdout);
    const researchReport = extractTextJson(text);
    if (researchReport === null) {
      throw providerError({
        code: "provider_schema_invalid",
        message: "claude-code-cli researcher did not return parseable JSON",
        retryable: false,
      });
    }
    const usage = normalizeUsageFromCli(result.parsed);
    return {
      providerName: this.name,
      researchReport,
      modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      cost: { estimatedUsd: usage.estimatedCostUsd ?? 0, currency: "USD" },
      providerArtifacts: {
        researcherInput: {
          promptVersion: RESEARCHER_PROMPT_VERSION,
          accessMode: "claude-code-cli",
          model: this.model ?? "default",
          binary: this.binary,
          args: result.args,
          prompt: redactedEnvelope.redacted,
          redaction: redactedEnvelope.summary,
        },
        researcherOutput: {
          promptVersion: RESEARCHER_PROMPT_VERSION,
          accessMode: "claude-code-cli",
          model: this.model ?? "default",
          cli: {
            binary: this.binary,
            args: result.args,
            stdout: redactForProvider(result.stdout, input.policy, this.env).redacted,
            stderr: redactForProvider(result.stderr, input.policy, this.env).redacted,
            durationMs: result.durationMs,
            startedAt: result.startedAt,
            completedAt: result.completedAt,
          },
          envelope: redactForProvider(result.parsed ?? result.stdout, input.policy, this.env).redacted,
          researchReport,
        },
      },
    };
  }
}

export class StubResearcherProvider implements ResearcherProvider {
  readonly name = "stub-researcher";

  async research(input: ResearcherProviderInput): Promise<ResearcherProviderOutput> {
    const context = buildRepoContextEnvelope({ initiative: input.initiative });
    const files = [
      ...new Set([...input.candidateFiles, ...context.grepHits.map((hit) => hit.path), ...context.localDiffPaths]),
    ]
      .filter(Boolean)
      .slice(0, 10);
    const generatedAt = input.requestedAt;
    return {
      providerName: this.name,
      researchReport: ResearchReportSchema.parse({
        schemaVersion: "1",
        runId: input.runId,
        initiativeId: input.initiative.id,
        relevantFiles: files.map((filePath) => ({
          path: filePath,
          reason: "Matched candidate, grep, or local diff context",
        })),
        symbolsOfInterest: [],
        openQuestions: files.length === 0 ? ["No relevant files were identified from bounded repository context."] : [],
        summary: "Deterministic stub research report from bounded repository context.",
        generatedAt,
      }),
      modelUsage: { inputTokens: 0, outputTokens: 0 },
      cost: { estimatedUsd: 0, currency: "USD" },
      providerArtifacts: {
        researcherInput: {
          promptVersion: RESEARCHER_PROMPT_VERSION,
          accessMode: "stub",
          model: "stub-researcher",
          repoContext: context,
          candidateFiles: input.candidateFiles,
        },
        researcherOutput: {
          promptVersion: RESEARCHER_PROMPT_VERSION,
          accessMode: "stub",
        },
      },
    };
  }
}
