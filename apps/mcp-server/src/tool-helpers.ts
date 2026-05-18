import { invalidToolArgumentIssue, ToolInputValidationError } from "./tool-input-schemas";

export interface ToolCallOptions {
  onProgress?: (message: string, percent?: number) => void;
}

export function toolArguments(params: Record<string, unknown>): Record<string, unknown> {
  const rawArguments = params.arguments;

  if (typeof rawArguments === "object" && rawArguments !== null && !Array.isArray(rawArguments)) {
    return rawArguments as Record<string, unknown>;
  }
  // Reject early MCP SDK fallbacks that smuggled tool args outside params.arguments.
  throw new ToolInputValidationError(String(params.name ?? "tools/call"), [
    invalidToolArgumentIssue(["arguments"], "tools/call params.arguments must be an object"),
  ]);
}

export function startHeartbeat(message: string, onProgress: ToolCallOptions["onProgress"]): NodeJS.Timeout | null {
  if (!onProgress) {
    return null;
  }

  return setInterval(() => onProgress(message), 30_000);
}

export function stopHeartbeat(timer: NodeJS.Timeout | null): void {
  if (timer) {
    clearInterval(timer);
  }
}

type ProgressValue = string | number | boolean | null | undefined;

function formatProgressValue(value: Exclude<ProgressValue, undefined>): string {
  const raw = String(value);

  return /^[A-Za-z0-9._:/@-]+$/.test(raw) ? raw : JSON.stringify(raw);
}

export function progressLine(fields: Record<string, ProgressValue>): string {
  return Object.entries(fields)
    .filter((entry): entry is [string, Exclude<ProgressValue, undefined>] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${formatProgressValue(value)}`)
    .join(" ");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function previewConfirmationSummary(params: {
  stepCount: number;
  repoPath: string;
  executionIsolation: string;
  estimatedCostUsd: number;
  command?: string | null;
}): string {
  return [
    `Execute ${params.stepCount} planned step(s) in ${params.repoPath}.`,
    `Execution mode: ${params.executionIsolation}.`,
    `Estimated cost: $${params.estimatedCostUsd.toFixed(4)}.`,
    params.command ? `Command override: ${JSON.stringify(params.command)}.` : null,
    "No staging, commit, tag, or push unless explicitly requested.",
  ]
    .filter((line): line is string => line !== null)
    .join(" ");
}
