import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import chalk from "chalk";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../../workspace/options";

interface TailOptions extends CliWorkspaceOptions {
  phase?: string;
  since?: string;
  noColor?: boolean;
  follow?: boolean;
  pollMs?: number;
}

interface AuditEventLine {
  eventType: string;
  runId: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

function auditPath(cwd: string): string {
  return path.join(cwd, ".kiwi", "logs", "audit.log");
}

function parseSince(value: string | undefined, now: Date): number | null {
  if (!value) {
    return null;
  }
  const relative = value.match(/^(\d+)(s|m|h)$/);

  if (relative?.[1] && relative[2]) {
    const amount = Number.parseInt(relative[1], 10);
    const multiplier = relative[2] === "h" ? 3_600_000 : relative[2] === "m" ? 60_000 : 1_000;

    return now.getTime() - amount * multiplier;
  }
  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? null : parsed;
}

function parseLine(line: string): AuditEventLine | null {
  try {
    const parsed = JSON.parse(line) as AuditEventLine;

    return typeof parsed.eventType === "string" && typeof parsed.runId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function matches(event: AuditEventLine, params: { runId: string; phase?: string; sinceMs: number | null }): boolean {
  if (event.runId !== params.runId) {
    return false;
  }
  if (params.sinceMs !== null && Date.parse(event.timestamp) < params.sinceMs) {
    return false;
  }
  if (!params.phase) {
    return true;
  }

  return event.payload?.phase === params.phase || event.eventType.includes(params.phase);
}

function formatEvent(event: AuditEventLine, noColor: boolean): string {
  const payload = event.payload ?? {};
  const parts = [
    event.timestamp,
    event.eventType,
    typeof payload.stepId === "string" ? `step=${payload.stepId}` : "",
    typeof payload.attemptId === "string" ? `attempt=${payload.attemptId}` : "",
    typeof payload.reason === "string" ? `reason=${JSON.stringify(payload.reason)}` : "",
  ].filter(Boolean);
  const line = parts.join(" ");

  return noColor
    ? line
    : `${chalk.dim(event.timestamp)} ${chalk.cyan(event.eventType)} ${parts.slice(2).join(" ")}`.trim();
}

function readNewLines(target: string, offset: number): { lines: string[]; offset: number } {
  if (!existsSync(target)) {
    return { lines: [], offset };
  }
  const size = statSync(target).size;
  const content = readFileSync(target, "utf-8");
  const slice = offset > 0 && offset <= content.length ? content.slice(offset) : content;

  return {
    lines: slice.split(/\r?\n/).filter((line) => line.trim().length > 0),
    offset: size,
  };
}

export async function runTail(
  runId: string,
  opts: TailOptions = {},
  cwd: string = process.cwd(),
  now: Date = new Date(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const target = auditPath(workspace.workspacePath);
  const sinceMs = parseSince(opts.since, now);
  let offset = 0;

  const printNew = (): void => {
    const result = readNewLines(target, offset);
    offset = result.offset;
    for (const line of result.lines) {
      const event = parseLine(line);
      const matchInput: Parameters<typeof matches>[1] = { runId, sinceMs };

      if (opts.phase) {
        matchInput.phase = opts.phase;
      }
      if (event && matches(event, matchInput)) {
        console.log(formatEvent(event, opts.noColor === true));
      }
    }
  };

  printNew();
  if (opts.follow === false) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setInterval(printNew, opts.pollMs ?? 1_000);
    const stop = (): void => {
      clearInterval(timer);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
