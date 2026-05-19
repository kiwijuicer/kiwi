import { AccessMode } from "@kiwi/contracts";
import type { ProviderAttemptType } from "../constants.js";
import { extractTextJson, isRecord } from "./json-utils.js";
import {
  PlannerProviderArtifacts,
  PlannerProviderError,
  PlannerProviderErrorCode,
  PlannerProviderInput,
  PlannerProviderOutput,
  PlannerProviderRepairContext,
  PlannerProviderSchedulerErrorCodes,
} from "./planner.js";
import { redactForProvider, RedactionSummary } from "./redaction.js";
import { buildRepoContextEnvelope, RepoContextEnvelope, renderRepoContext } from "./repo-context.js";
import { buildRunnerEnv } from "../runners/env.js";
import {
  buildPlannerRepairEnvelope,
  buildPlannerUserEnvelope,
  plannerToolDefinition,
  PLANNER_PROMPT_VERSION,
  PLANNER_SYSTEM_PROMPT,
} from "../prompts/planner-v1/index.js";

export interface CliPlannerResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  parsed: unknown;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  binary: string;
  args: string[];
  timedOut: boolean;
}

export interface CliPlannerUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

interface CliPlannerInvokeParams {
  providerName: string;
  label: string;
  accessMode: AccessMode;
  binary: string;
  model: string | undefined;
  input: PlannerProviderInput;
  attemptType: ProviderAttemptType;
  context?: PlannerProviderRepairContext;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  run: (prompt: string, env: Record<string, string | undefined>) => Promise<CliPlannerResult>;
  normalizeUsage: (parsed: unknown) => CliPlannerUsage;
}

interface RedactedInvocationArtifact {
  attemptType: ProviderAttemptType;
  promptVersion: string;
  model: string;
  binary: string;
  args: string[];
  prompt: string;
  redaction: RedactionSummary;
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

function mergeRedactionSummaries(...summaries: RedactionSummary[]): RedactionSummary {
  return {
    secretEnvNames: [...new Set(summaries.flatMap((summary) => summary.secretEnvNames))].sort(),
    envSecretValuesRedacted: summaries.reduce((total, summary) => total + summary.envSecretValuesRedacted, 0),
    detectedPatterns: [...new Set(summaries.flatMap((summary) => summary.detectedPatterns))].sort(),
  };
}

function collectTextCandidates(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);

    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectTextCandidates(entry, output);
    }

    return output;
  }
  if (!isRecord(value)) {
    return output;
  }

  for (const key of ["result", "text", "output", "final_output", "message", "content"]) {
    const entry = value[key];

    if (typeof entry === "string") {
      output.push(entry);
    } else if (Array.isArray(entry) || isRecord(entry)) {
      collectTextCandidates(entry, output);
    }
  }
  for (const entry of Object.values(value)) {
    if (Array.isArray(entry) || isRecord(entry)) {
      collectTextCandidates(entry, output);
    }
  }

  return output;
}

export function extractCliPlannerText(parsed: unknown, fallback: string): string {
  const candidates = collectTextCandidates(parsed).filter((entry) => entry.trim().length > 0);
  const jsonCandidate = [...candidates].reverse().find((entry) => /"planId"|"steps"|"subPlans"/.test(entry));

  return jsonCandidate ?? candidates.at(-1) ?? fallback;
}

function truncateCliDetail(value: string, maxLength: number): string {
  const text = value.trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

export function formatExternalCliFailure(
  label: string,
  result: Pick<CliPlannerResult, "exitCode" | "parsed" | "stderr" | "stdout">,
  maxLength = 500,
): string {
  const parsedText = extractCliPlannerText(result.parsed, "");
  const detail = truncateCliDetail(parsedText || result.stderr || result.stdout || "no CLI output", maxLength);

  return `${label} exited ${result.exitCode}: ${detail}`;
}

function buildPrompt(params: {
  input: PlannerProviderInput;
  attemptType: ProviderAttemptType;
  context?: PlannerProviderRepairContext;
  env: Record<string, string | undefined>;
}): {
  prompt: string;
  redactedInput: ReturnType<typeof redactForProvider<PlannerProviderInput>>;
  redactedEnvelope: ReturnType<typeof redactForProvider<string>>;
  redactedRepoContext: ReturnType<typeof redactForProvider<RepoContextEnvelope>>;
} {
  const userEnvelope =
    params.attemptType === "repair" && params.context
      ? buildPlannerRepairEnvelope({
          input: params.input,
          invalidAttempt: params.context.invalidAttempt,
          invalidOutput: params.context.invalidOutput,
          validationError: params.context.validationError,
        })
      : buildPlannerUserEnvelope(params.input);
  const redactedInput = redactForProvider(params.input, params.input.policy, params.env);
  const redactedEnvelope = redactForProvider(userEnvelope, params.input.policy, params.env);
  const repoContext = buildRepoContextEnvelope({ initiative: params.input.initiative });
  const redactedRepoContext = redactForProvider(repoContext, params.input.policy, params.env);
  const plannerToolSchema = JSON.stringify(plannerToolDefinition().input_schema, null, 2);
  const prompt = `${PLANNER_SYSTEM_PROMPT}

Repository context:
${renderRepoContext(redactedRepoContext.redacted)}

TaskGraph JSON schema:
${plannerToolSchema}

Planner request:
${redactedEnvelope.redacted}

Return only a JSON TaskGraph; do not explain.`;

  return { prompt, redactedInput, redactedEnvelope, redactedRepoContext };
}

export async function invokeCliPlanner(params: CliPlannerInvokeParams): Promise<PlannerProviderOutput> {
  const { prompt, redactedInput, redactedEnvelope, redactedRepoContext } = buildPrompt({
    input: params.input,
    attemptType: params.attemptType,
    env: params.env,
    ...(params.context ? { context: params.context } : {}),
  });
  const env = buildRunnerEnv({ sourceEnv: params.env, policy: params.input.policy.commandProfiles.default });
  const result = await params.run(prompt, env);

  if (!result.ok) {
    throw providerError({
      code: result.timedOut ? "provider_timeout" : "provider_network",
      message: result.timedOut
        ? `${params.label} planner request timed out after ${params.timeoutMs}ms`
        : formatExternalCliFailure(`${params.label} planner`, result),
      retryable: result.timedOut,
    });
  }

  const text = extractCliPlannerText(result.parsed, result.stdout);
  const taskGraph = extractTextJson(text);

  if (taskGraph === null) {
    throw providerError({
      code: "provider_schema_invalid",
      message: `${params.label} planner did not return parseable JSON`,
      retryable: false,
    });
  }

  const usage = params.normalizeUsage(result.parsed);
  const previous = previousAttempts(params.context);
  const attemptArtifact: RedactedInvocationArtifact = {
    attemptType: params.attemptType,
    promptVersion: PLANNER_PROMPT_VERSION,
    model: params.model ?? "default",
    binary: params.binary,
    args: result.args,
    prompt,
    redaction: mergeRedactionSummaries(redactedInput.summary, redactedEnvelope.summary, redactedRepoContext.summary),
  };
  const cliArtifact = redactForProvider(result.parsed ?? result.stdout, params.input.policy, params.env);
  const redactedStdout = redactForProvider(result.stdout, params.input.policy, params.env).redacted;
  const redactedStderr = redactForProvider(result.stderr, params.input.policy, params.env).redacted;
  const providerArtifacts: PlannerProviderArtifacts = {
    plannerInput: {
      promptVersion: PLANNER_PROMPT_VERSION,
      accessMode: params.accessMode,
      model: params.model ?? "default",
      redactedInput: redactedInput.redacted,
      repoContext: redactedRepoContext.redacted,
      attempts: [...previous, attemptArtifact],
    },
    plannerOutput: {
      promptVersion: PLANNER_PROMPT_VERSION,
      accessMode: params.accessMode,
      model: params.model ?? "default",
      cli: {
        binary: params.binary,
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
    providerName: params.providerName,
    taskGraph,
    modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
    cost: {
      estimatedUsd: usage.estimatedCostUsd ?? 0,
      currency: "USD",
    },
    providerArtifacts,
  };
}
