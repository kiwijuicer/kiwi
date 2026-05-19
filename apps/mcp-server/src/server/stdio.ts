import { debugLog } from "./debug-log.js";
import { defaultServerCwd, handleMcpMessage } from "./protocol.js";

const MAX_STDIO_MESSAGE_BYTES = 4 * 1024 * 1024;

function encodeStdioMessage(payload: unknown): string {
  return `${JSON.stringify(payload)}\n`;
}

function writeInvalidRequest(writeResponse: (payload: unknown) => void): void {
  writeResponse({
    jsonrpc: "2.0",
    id: null,
    error: { code: -32600, message: "Invalid request" },
  });
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
  let discardingOversizedLine = false;

  return async function drainMessages(chunk: Buffer): Promise<void> {
    buffer = Buffer.concat([buffer, chunk]);
    debugLog("stdio_chunk", { bytes: chunk.length, bufferedBytes: buffer.length });

    for (;;) {
      const newline = buffer.indexOf("\n");

      if (discardingOversizedLine) {
        if (newline < 0) {
          buffer = Buffer.alloc(0);

          return;
        }
        buffer = buffer.subarray(newline + 1);
        discardingOversizedLine = false;
        continue;
      }

      if (newline < 0) {
        if (buffer.length > MAX_STDIO_MESSAGE_BYTES) {
          debugLog("stdio_line_too_large", { bufferedBytes: buffer.length, maxBytes: MAX_STDIO_MESSAGE_BYTES });
          buffer = Buffer.alloc(0);
          discardingOversizedLine = true;
          writeInvalidRequest(writeResponse);
        }

        return;
      }

      if (newline > MAX_STDIO_MESSAGE_BYTES) {
        debugLog("stdio_line_too_large", { bufferedBytes: newline, maxBytes: MAX_STDIO_MESSAGE_BYTES });
        buffer = buffer.subarray(newline + 1);
        writeInvalidRequest(writeResponse);
        continue;
      }

      const body = buffer.subarray(0, newline).toString("utf-8").replace(/\r$/, "");
      buffer = buffer.subarray(newline + 1);
      if (body.length === 0) {
        continue;
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

class StdioMcpTransport {
  start(cwd: string = defaultServerCwd()): void {
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
}

export function startMcpServer(cwd: string = defaultServerCwd()): void {
  new StdioMcpTransport().start(cwd);
}
