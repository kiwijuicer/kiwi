import { runSubprocess, SubprocessOutputChunk } from "../subprocess";

export const CODEX_AUTO_REVIEW_APPROVAL_POLICY = "on-request" as const;
export const CODEX_AUTO_REVIEW_APPROVALS_REVIEWER = "auto_review" as const;
export const CODEX_AUTO_REVIEW_SANDBOX = "workspace-write" as const;

export interface CodexCliInvocation {
  binary: string;
  cwd: string;
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never";
  approvalsReviewer?: "user" | "auto_review" | "guardian_subagent";
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

export function buildCodexCliArgs(invocation: CodexCliInvocation): string[] {
  const args = ["exec", "--json", "--cd", invocation.cwd, "--skip-git-repo-check", "--ephemeral"];
  args.push(
    "--sandbox",
    invocation.sandbox ?? CODEX_AUTO_REVIEW_SANDBOX,
    "-c",
    `approval_policy="${invocation.approvalPolicy ?? CODEX_AUTO_REVIEW_APPROVAL_POLICY}"`,
    "-c",
    `approvals_reviewer="${invocation.approvalsReviewer ?? CODEX_AUTO_REVIEW_APPROVALS_REVIEWER}"`,
  );
  if (invocation.model) {
    args.push("--model", invocation.model);
  }
  args.push(invocation.prompt);

  return args;
}

export class DefaultCodexCliRunner implements CodexCliRunner {
  async run(invocation: CodexCliInvocation): Promise<CodexCliResult> {
    const args = buildCodexCliArgs(invocation);
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
  if (Array.isArray(value)) {
    return value.flatMap(nestedRecords);
  }
  if (!isRecord(value)) {
    return [];
  }
  const out = [value];

  for (const nested of Object.values(value)) {
    if (isRecord(nested) || Array.isArray(nested)) {
      out.push(...nestedRecords(nested));
    }
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
