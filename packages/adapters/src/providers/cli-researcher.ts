import { AccessMode } from "@kiwi/contracts";
import { extractTextJson } from "../integrations/anthropic/common";
import { CliPlannerResult, extractCliPlannerText, formatExternalCliFailure } from "./cli-planner";
import { redactForProvider } from "./redaction";
import {
  buildResearchEnvelope,
  ResearcherProviderError,
  ResearcherProviderInput,
  ResearcherProviderOutput,
  researchToolDefinition,
  RESEARCHER_PROMPT_VERSION,
} from "./researcher";
import { buildRunnerEnv } from "../runners/env";

export interface CliResearcherUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

interface CliResearcherInvokeParams {
  providerName: string;
  label: string;
  accessMode: AccessMode;
  binary: string;
  model: string | undefined;
  input: ResearcherProviderInput;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  run: (prompt: string, env: Record<string, string | undefined>) => Promise<CliPlannerResult>;
  normalizeUsage: (parsed: unknown) => CliResearcherUsage;
}

function providerError(params: {
  code: ResearcherProviderError["code"];
  message: string;
  retryable: boolean;
  statusCode?: number;
}): ResearcherProviderError {
  return new ResearcherProviderError(params.code, params.message, params.retryable, params.statusCode);
}

function buildCliResearchPrompt(redactedEnvelope: string): string {
  const schema = JSON.stringify(researchToolDefinition().input_schema, null, 2);

  return `You are kiwi's researcher agent. Return concise structured repository context only.

Prompt version: ${RESEARCHER_PROMPT_VERSION}

ResearchReport JSON schema:
${schema}

Researcher request:
${redactedEnvelope}

Return only JSON matching ResearchReportSchema; no commentary.`;
}

export async function invokeCliResearcher(params: CliResearcherInvokeParams): Promise<ResearcherProviderOutput> {
  const envelope = buildResearchEnvelope(params.input);
  const redactedEnvelope = redactForProvider(envelope, params.input.policy, params.env);
  const prompt = buildCliResearchPrompt(redactedEnvelope.redacted);
  const result = await params.run(
    prompt,
    buildRunnerEnv({ sourceEnv: params.env, policy: params.input.policy.commandProfiles.default }),
  );

  if (!result.ok) {
    throw providerError({
      code: result.timedOut ? "provider_timeout" : "provider_network",
      message: result.timedOut
        ? `${params.label} researcher request timed out after ${params.timeoutMs}ms`
        : formatExternalCliFailure(`${params.label} researcher`, result),
      retryable: result.timedOut,
    });
  }
  const text = extractCliPlannerText(result.parsed, result.stdout);
  const researchReport = extractTextJson(text);

  if (researchReport === null) {
    throw providerError({
      code: "provider_schema_invalid",
      message: `${params.label} researcher did not return parseable JSON`,
      retryable: false,
    });
  }
  const usage = params.normalizeUsage(result.parsed);

  return {
    providerName: params.providerName,
    researchReport,
    modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
    cost: { estimatedUsd: usage.estimatedCostUsd ?? 0, currency: "USD" },
    providerArtifacts: {
      researcherInput: {
        promptVersion: RESEARCHER_PROMPT_VERSION,
        accessMode: params.accessMode,
        model: params.model ?? "default",
        binary: params.binary,
        args: result.args,
        prompt,
        redaction: redactedEnvelope.summary,
      },
      researcherOutput: {
        promptVersion: RESEARCHER_PROMPT_VERSION,
        accessMode: params.accessMode,
        model: params.model ?? "default",
        cli: {
          binary: params.binary,
          args: result.args,
          stdout: redactForProvider(result.stdout, params.input.policy, params.env).redacted,
          stderr: redactForProvider(result.stderr, params.input.policy, params.env).redacted,
          durationMs: result.durationMs,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
        },
        envelope: redactForProvider(result.parsed ?? result.stdout, params.input.policy, params.env).redacted,
        researchReport,
      },
    },
  };
}
