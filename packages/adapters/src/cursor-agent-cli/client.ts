import type { UsagePrecision } from "@kiwi/contracts";
import type { CliOutputFormat } from "../constants";
import { runSubprocess, SubprocessOutputChunk } from "../subprocess";

export interface CursorAgentCliInvocation {
  binary: string;
  cwd: string;
  model?: string;
  prompt: string;
  outputFormat?: CliOutputFormat;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
  /** Called for each stdout/stderr chunk as it arrives. Optional. */
  onOutputChunk?: (chunk: SubprocessOutputChunk) => void;
}

export interface CursorAgentCliResult {
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

export interface CursorAgentCliRunner {
  run(invocation: CursorAgentCliInvocation): Promise<CursorAgentCliResult>;
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const lines = trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const parsedLines = lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });

    if (parsedLines.length > 0) {
      return parsedLines;
    }
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

function buildArgs(invocation: CursorAgentCliInvocation): string[] {
  const args = ["-p", invocation.prompt, "--output-format", invocation.outputFormat ?? "json"];

  if (invocation.model) {
    args.push("--model", invocation.model);
  }

  return args;
}

export class DefaultCursorAgentCliRunner implements CursorAgentCliRunner {
  async run(invocation: CursorAgentCliInvocation): Promise<CursorAgentCliResult> {
    const args = buildArgs(invocation);
    const result = await runSubprocess({
      binary: invocation.binary,
      args,
      cwd: invocation.cwd,
      env: invocation.env,
      timeoutMs: invocation.timeoutMs,
      ...(invocation.onOutputChunk ? { onOutputChunk: invocation.onOutputChunk } : {}),
    });

    return {
      ...result,
      parsed: tryParseJson(result.stdout),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  return isRecord(value) ? [value] : [];
}

export interface NormalizedCursorUsage {
  precision: UsagePrecision;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export function normalizeUsageFromCursorAgent(parsed: unknown): NormalizedCursorUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd: number | null = null;

  for (const record of records(parsed)) {
    const usage = isRecord(record.usage) ? record.usage : record;
    const input = usage.input_tokens ?? usage.inputTokens;
    const output = usage.output_tokens ?? usage.outputTokens;
    const cost = record.total_cost_usd ?? record.totalCostUsd ?? record.estimatedCostUsd;

    if (typeof input === "number") {
      inputTokens += input;
    }
    if (typeof output === "number") {
      outputTokens += output;
    }
    if (typeof cost === "number") {
      estimatedCostUsd = (estimatedCostUsd ?? 0) + cost;
    }
  }
  if (inputTokens === 0 && outputTokens === 0 && estimatedCostUsd === null) {
    return { precision: "unknown", inputTokens: 0, outputTokens: 0, estimatedCostUsd: null };
  }

  return {
    precision: estimatedCostUsd === null ? "estimated" : "exact",
    inputTokens,
    outputTokens,
    estimatedCostUsd,
  };
}
