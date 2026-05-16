import { Buffer } from "buffer";
import { debugLog } from "./debug-log";
import { defaultServerCwd, handleMcpMessage } from "./protocol";

function encodeStdioMessage(payload: unknown): string {
  return `${JSON.stringify(payload)}\n`;
}

function findHeaderSeparator(buffer: Buffer): { index: number; length: number } | null {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");

  if (crlf < 0 && lf < 0) {
    return null;
  }
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) {
    return { index: crlf, length: 4 };
  }

  return { index: lf, length: 2 };
}

function startsWithContentLength(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 32)).toString("ascii").toLowerCase().startsWith("content-length:");
}

async function handleParsedMcpMessage(
  value: unknown,
  cwd: string,
  writeResponse: (payload: unknown) => void,
): Promise<void> {
  const response = await handleMcpMessage(value, cwd, { sendNotification: writeResponse });

  if (response !== undefined) {
    writeResponse(response);
  }
}

export function createMcpMessageDrainer(
  cwd: string,
  writeResponse: (payload: unknown) => void,
): (chunk: Buffer) => Promise<void> {
  let buffer = Buffer.alloc(0);

  // eslint-disable-next-line sonarjs/cognitive-complexity
  return async function drainMessages(chunk: Buffer): Promise<void> {
    buffer = Buffer.concat([buffer, chunk]);
    debugLog("stdio_chunk", { bytes: chunk.length, bufferedBytes: buffer.length });

    for (;;) {
      let body: string | null = null;

      if (startsWithContentLength(buffer)) {
        const separator = findHeaderSeparator(buffer);

        if (!separator) {
          return;
        }

        const header = buffer.subarray(0, separator.index).toString("ascii");
        const match = header.match(/Content-Length:\s*(\d+)/i);

        if (!match?.[1]) {
          return;
        }

        const length = Number(match[1]);
        const start = separator.index + separator.length;
        const end = start + length;

        if (buffer.length < end) {
          return;
        }

        body = buffer.subarray(start, end).toString("utf-8");
        buffer = buffer.subarray(end);
      } else {
        const newline = buffer.indexOf("\n");

        if (newline < 0) {
          return;
        }

        body = buffer.subarray(0, newline).toString("utf-8").replace(/\r$/, "");
        buffer = buffer.subarray(newline + 1);
        if (body.length === 0) {
          continue;
        }
      }

      let message: unknown;

      try {
        message = JSON.parse(body) as unknown;
      } catch {
        debugLog("parse_error", { bytes: body.length });
        writeResponse({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
        continue;
      }

      debugLog("message", { batch: Array.isArray(message) });
      await handleParsedMcpMessage(message, cwd, writeResponse);
    }
  };
}

export function startMcpServer(cwd: string = defaultServerCwd()): void {
  debugLog("server_start", { cwd, pid: process.pid });
  const drainMessages = createMcpMessageDrainer(cwd, (payload) => {
    process.stdout.write(encodeStdioMessage(payload));
  });
  let drain = Promise.resolve();

  process.stdin.on("data", (chunk) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf-8");
    drain = drain.then(
      () => drainMessages(data),
      () => drainMessages(data),
    );
  });
}
