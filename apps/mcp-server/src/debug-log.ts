import { appendFileSync, mkdirSync } from "fs";
import path from "path";

export function debugLog(message: string, details: Record<string, unknown> = {}): void {
  const target = process.env.KIWI_MCP_DEBUG_LOG;

  if (!target) {
    return;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(
    target,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      message,
      ...details,
    })}\n`,
    "utf-8",
  );
}
