import { runSubprocess } from "../subprocess";

export interface ClaudeCodeCliInvocation {
  binary: string;
  cwd?: string;
  model?: string;
  prompt: string;
  systemPrompt?: string;
  outputFormat?: "json" | "text";
  allowedTools?: string[];
  appendSystemPrompt?: string;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
  extraArgs?: string[];
}

export interface ClaudeCodeCliResult {
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

export interface ClaudeCodeCliRunner {
  run(invocation: ClaudeCodeCliInvocation): Promise<ClaudeCodeCliResult>;
}

function tryParseJson(text: string): unknown {
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

function buildArgs(invocation: ClaudeCodeCliInvocation): string[] {
  const args: string[] = ["-p", invocation.prompt];
  if (invocation.outputFormat) {
    args.push("--output-format", invocation.outputFormat);
  }
  if (invocation.model) {
    args.push("--model", invocation.model);
  }
  if (invocation.systemPrompt) {
    args.push("--system-prompt", invocation.systemPrompt);
  }
  if (invocation.appendSystemPrompt) {
    args.push("--append-system-prompt", invocation.appendSystemPrompt);
  }
  if (invocation.allowedTools && invocation.allowedTools.length > 0) {
    args.push("--allowedTools", invocation.allowedTools.join(","));
  }
  if (invocation.extraArgs && invocation.extraArgs.length > 0) {
    args.push(...invocation.extraArgs);
  }
  return args;
}

export class DefaultClaudeCodeCliRunner implements ClaudeCodeCliRunner {
  async run(invocation: ClaudeCodeCliInvocation): Promise<ClaudeCodeCliResult> {
    const args = buildArgs(invocation);
    const result = await runSubprocess({
      binary: invocation.binary,
      args,
      cwd: invocation.cwd,
      env: invocation.env,
      timeoutMs: invocation.timeoutMs,
    });
    const parsed =
      invocation.outputFormat === "json" || invocation.outputFormat === undefined ? tryParseJson(result.stdout) : null;
    return {
      ...result,
      parsed,
    };
  }
}

export interface ClaudeCodeJsonEnvelope {
  result?: string;
  type?: string;
  is_error?: boolean;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
  session_id?: string;
}

function isClaudeCodeJsonEnvelope(value: unknown): value is ClaudeCodeJsonEnvelope {
  return typeof value === "object" && value !== null;
}

export interface NormalizedClaudeCodeUsage {
  precision: "exact" | "estimated" | "unknown";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number | null;
}

export function normalizeUsageFromCli(parsed: unknown): NormalizedClaudeCodeUsage {
  if (!isClaudeCodeJsonEnvelope(parsed)) {
    return {
      precision: "unknown",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: null,
    };
  }
  const usage = parsed.usage ?? {};
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  const cacheRead = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
  const cacheWrite = typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0;
  const totalCost = typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : null;
  if (inputTokens === 0 && outputTokens === 0 && cacheRead === 0 && cacheWrite === 0 && totalCost === null) {
    return {
      precision: "unknown",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: null,
    };
  }
  return {
    precision: totalCost !== null ? "exact" : "estimated",
    inputTokens: inputTokens + cacheRead + cacheWrite,
    outputTokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    estimatedCostUsd: totalCost,
  };
}

export function extractCliResultText(parsed: unknown, fallback: string): string {
  if (isClaudeCodeJsonEnvelope(parsed) && typeof parsed.result === "string") {
    return parsed.result;
  }
  return fallback;
}
