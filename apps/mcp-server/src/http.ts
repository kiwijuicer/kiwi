import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { debugLog } from "./debug-log";
import { defaultServerCwd, handleMcpMessage } from "./protocol";

export interface HttpMcpServerOptions {
  cwd?: string;
  host?: string;
  port?: number;
  path?: string;
  allowedOrigins?: string[];
  authToken?: string;
}

export function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid HTTP port: ${value}`);
  }

  return port;
}

function allowedOriginsFromEnv(): string[] {
  return (process.env.KIWI_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) {
    return true;
  }
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const parsed = new URL(origin);

    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function applyCorsHeaders(request: IncomingMessage, response: ServerResponse, allowedOrigins: string[]): void {
  const origin = request.headers.origin;

  if (typeof origin !== "string" || !isAllowedOrigin(origin, allowedOrigins)) {
    return;
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "authorization, content-type, accept, mcp-session-id");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function isAuthorized(request: IncomingMessage, authToken: string): boolean {
  return request.headers.authorization === `Bearer ${authToken}`;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body, "utf-8"),
  });
  response.end(body);
}

function acceptsSse(request: IncomingMessage): boolean {
  const accept = request.headers.accept;

  return typeof accept === "string" && accept.includes("text/event-stream");
}

function writeSse(response: ServerResponse, payload: unknown): void {
  response.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
}

function readRequestBody(request: IncomingMessage, maxBytes = 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    request.on("data", (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf-8");
      totalBytes += data.length;
      if (totalBytes > maxBytes) {
        reject(new Error("MCP HTTP request body is too large"));
        request.destroy();

        return;
      }
      chunks.push(data);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function handleHttpMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  params: {
    cwd: string;
    endpointPath: string;
    allowedOrigins: string[];
    authToken: string;
  },
): Promise<void> {
  const { cwd, endpointPath, allowedOrigins, authToken } = params;
  applyCorsHeaders(request, response, allowedOrigins);

  if (
    !isAllowedOrigin(typeof request.headers.origin === "string" ? request.headers.origin : undefined, allowedOrigins)
  ) {
    response.writeHead(403);
    response.end();

    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname !== endpointPath) {
    response.writeHead(404);
    response.end();

    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();

    return;
  }

  if (request.method === "GET") {
    response.writeHead(405, { allow: "POST, GET, OPTIONS" });
    response.end();

    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST, GET, OPTIONS" });
    response.end();

    return;
  }

  if (!isAuthorized(request, authToken)) {
    sendJson(response, 401, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Unauthorized" },
    });

    return;
  }

  let message: unknown;

  try {
    message = JSON.parse((await readRequestBody(request)).toString("utf-8")) as unknown;
  } catch (error) {
    const parseMessage =
      error instanceof SyntaxError ? "Parse error" : error instanceof Error ? error.message : "Parse error";
    sendJson(response, 400, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: parseMessage },
    });

    return;
  }

  if (acceptsSse(request)) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const payload = await handleMcpMessage(message, cwd, {
      sendNotification: (notification) => writeSse(response, notification),
    });

    if (payload !== undefined) {
      writeSse(response, payload);
    }
    response.end();

    return;
  }

  const payload = await handleMcpMessage(message, cwd);

  if (payload === undefined) {
    response.writeHead(202);
    response.end();

    return;
  }

  sendJson(response, 200, payload);
}

class HttpMcpTransport {
  start(options: HttpMcpServerOptions = {}): Server {
    const cwd = options.cwd ?? defaultServerCwd();
    const host = options.host ?? process.env.KIWI_MCP_HTTP_HOST ?? "127.0.0.1";
    const port = options.port ?? parsePort(process.env.KIWI_MCP_HTTP_PORT, 3333);
    const endpointPath = options.path ?? process.env.KIWI_MCP_HTTP_PATH ?? "/mcp";
    const allowedOrigins = options.allowedOrigins ?? allowedOriginsFromEnv();
    const authToken = options.authToken ?? process.env.KIWI_MCP_HTTP_TOKEN;

    if (!authToken) {
      throw new Error("KIWI_MCP_HTTP_TOKEN is required for HTTP MCP transport");
    }

    const server = createServer((request, response) => {
      void handleHttpMcpRequest(request, response, { cwd, endpointPath, allowedOrigins, authToken }).catch((error) => {
        debugLog("http_error", { error: error instanceof Error ? error.stack || error.message : String(error) });
        if (!response.headersSent) {
          sendJson(response, 500, {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32000, message: "Internal server error" },
          });

          return;
        }
        response.end();
      });
    });

    server.listen(port, host, () => {
      debugLog("http_server_start", { cwd, host, port, endpointPath });
    });

    return server;
  }
}

export function startHttpMcpServer(options: HttpMcpServerOptions = {}): Server {
  return new HttpMcpTransport().start(options);
}
