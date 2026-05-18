import { createWriteStream, mkdirSync, type WriteStream } from "fs";
import path from "path";

let streamPath: string | null = null;
let stream: WriteStream | null = null;

function logStream(target: string): WriteStream {
  if (stream && streamPath === target) {
    return stream;
  }
  if (stream) {
    stream.end();
  }
  mkdirSync(path.dirname(target), { recursive: true });
  streamPath = target;
  stream = createWriteStream(target, { flags: "a" });

  return stream;
}

export function debugLog(message: string, details: Record<string, unknown> = {}): void {
  const target = process.env.KIWI_MCP_DEBUG_LOG;

  if (!target) {
    return;
  }
  logStream(target).write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      message,
      ...details,
    })}\n`,
    "utf-8",
  );
}
