import { runSubprocess, SubprocessOutputChunk } from "../subprocess";

export interface CodexCliInvocation {
  binary: string;
  cwd: string;
  model?: string;
  prompt: string;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
  /** Called for each stdout/stderr chunk as it arrives. Optional. */
  onOutputChunk?: (chunk: SubprocessOutputChunk) => void;
}

export interface CodexCliResult {
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

export interface CodexCliRunner {
  run(invocation: CodexCliInvocation): Promise<CodexCliResult>;
}

function parseJsonLines(text: string): unknown[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

function buildArgs(invocation: CodexCliInvocation): string[] {
  const args = [
    "exec",
    "--json",
    "--cd",
    invocation.cwd,
    "--sandbox",
    "workspace-write",
    "--ask-for-approval",
    "never",
    "--skip-git-repo-check",
  ];
  if (invocation.model) {
    args.push("--model", invocation.model);
  }
  args.push(invocation.prompt);
  return args;
}

export class DefaultCodexCliRunner implements CodexCliRunner {
  async run(invocation: CodexCliInvocation): Promise<CodexCliResult> {
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
      parsed: parseJsonLines(result.stdout),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nestedRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(nestedRecords);
  if (!isRecord(value)) return [];
  const out = [value];
  for (const nested of Object.values(value)) {
    if (isRecord(nested) || Array.isArray(nested)) out.push(...nestedRecords(nested));
  }
  return out;
}

export interface NormalizedCodexUsage {
  precision: "exact" | "estimated" | "unknown";
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export function normalizeUsageFromCodex(parsed: unknown): NormalizedCodexUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd: number | null = null;
  for (const record of nestedRecords(parsed)) {
    const input = record.input_tokens ?? record.inputTokens ?? record.prompt_tokens ?? record.promptTokens;
    const output = record.output_tokens ?? record.outputTokens ?? record.completion_tokens ?? record.completionTokens;
    const cost = record.total_cost_usd ?? record.totalCostUsd ?? record.estimatedCostUsd;
    if (typeof input === "number") inputTokens += input;
    if (typeof output === "number") outputTokens += output;
    if (typeof cost === "number") estimatedCostUsd = (estimatedCostUsd ?? 0) + cost;
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
