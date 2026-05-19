import { AccessMode, ContractValues, GateResultSchema, RunnerName, UsagePrecision } from "@kiwi/contracts";
import { ProviderFailureCodes } from "../constants.js";
import { RunnerExecutionInput, RunnerExecutionOutput } from "./adapter.js";
import { captureRunnerDiffArtifact } from "./diff-artifact.js";
import { persistRunnerLogs } from "./logs.js";

export interface CliRunnerProcessResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  binary: string;
  args: string[];
  timedOut: boolean;
}

export interface NormalizedCliRunnerUsage {
  precision: UsagePrecision;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export function runnerTimeoutMs(input: RunnerExecutionInput, adapterTimeoutMs: number): number {
  return Math.min(adapterTimeoutMs, Math.max(input.timeouts.commandTimeoutMs, 60_000) * 5);
}

function parseCliJsonOutput(output: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(output) as unknown;

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function providerLimitMessage(result: CliRunnerProcessResult, label: string): string | null {
  const payload = parseCliJsonOutput(result.stdout);
  const status = payload?.api_error_status;
  const resultText = typeof payload?.result === "string" ? payload.result : "";
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  const looksLimited =
    status === 429 ||
    combined.includes("429") ||
    combined.includes("rate limit") ||
    combined.includes("limit reached") ||
    combined.includes("hit your limit");

  if (!looksLimited) {
    return null;
  }

  return `${label} provider rate limited (HTTP 429): ${resultText || "provider limit reached"}`;
}

export function cliRunnerOutput(params: {
  input: RunnerExecutionInput;
  runnerName: RunnerName;
  result: CliRunnerProcessResult;
  usage: NormalizedCliRunnerUsage;
  modelId: string | null;
  providerName: AccessMode;
  timeoutMs: number;
  label: string;
  /** Absolute path to the live stream file, if streaming was enabled for this run. */
  liveLogPath?: string | null;
}): RunnerExecutionOutput {
  const logsArtifact = persistRunnerLogs({
    workspacePath: params.input.workspacePath,
    runId: params.input.runId,
    stepId: params.input.stepId,
    attemptId: params.input.attemptId,
    runner: params.runnerName,
    payload: {
      binary: params.result.binary,
      args: params.result.args,
      stdout: params.result.stdout,
      stderr: params.result.stderr,
      exitCode: params.result.exitCode,
      timedOut: params.result.timedOut,
      durationMs: params.result.durationMs,
      startedAt: params.result.startedAt,
      completedAt: params.result.completedAt,
    },
    secretValues: params.input.commandPolicy?.secretValues,
  });
  const diffArtifact = captureRunnerDiffArtifact(params.input);
  const artifactRefs = diffArtifact ? [logsArtifact, diffArtifact] : [logsArtifact];
  const baseOutput = {
    artifactRefs,
    rawLogsRef: logsArtifact.ref,
    liveLogPath: params.liveLogPath ?? null,
    modelUsage: { inputTokens: params.usage.inputTokens, outputTokens: params.usage.outputTokens },
    modelId: params.modelId,
    providerName: params.providerName,
    accessMode: params.providerName,
    usagePrecision: params.usage.precision,
    estimatedCostUsd: params.usage.estimatedCostUsd,
  };

  if (params.result.timedOut) {
    return {
      ...baseOutput,
      status: "timeout",
      gateResult: GateResultSchema.parse({
        gateId: "gate_runner_execution",
        gateType: "forbidden_file_checks",
        status: ContractValues.Fail,
        evidenceRefs: [logsArtifact.ref],
        reason: `${params.label} runner timed out after ${params.timeoutMs}ms`,
      }),
      error: {
        code: "RUNNER_TIMEOUT",
        message: `${params.label} runner timed out after ${params.timeoutMs}ms`,
      },
    };
  }

  if (!params.result.ok) {
    const rateLimitMessage = providerLimitMessage(params.result, params.label);
    const errorCode = rateLimitMessage
      ? ProviderFailureCodes.RateLimited
      : `RUNNER_EXIT_${params.result.exitCode ?? "UNKNOWN"}`;
    const errorMessage = rateLimitMessage ?? (params.result.stderr.slice(0, 500) || `${params.label} runner failed`);

    return {
      ...baseOutput,
      status: ContractValues.Failed,
      gateResult: GateResultSchema.parse({
        gateId: "gate_runner_execution",
        gateType: "forbidden_file_checks",
        status: ContractValues.Fail,
        evidenceRefs: [logsArtifact.ref],
        reason:
          rateLimitMessage ??
          `${params.label} runner exited ${params.result.exitCode}: ${params.result.stderr.slice(0, 200)}`,
      }),
      error: {
        code: errorCode,
        message: errorMessage,
      },
    };
  }

  return {
    ...baseOutput,
    status: ContractValues.Completed,
    gateResult: GateResultSchema.parse({
      gateId: "gate_runner_execution",
      gateType: "forbidden_file_checks",
      status: ContractValues.Pass,
      evidenceRefs: [logsArtifact.ref],
      reason: diffArtifact
        ? `${params.label} runner produced diff`
        : `${params.label} runner completed without changes`,
    }),
  };
}
