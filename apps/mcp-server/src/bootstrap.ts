import { defaultServerCwd } from "./protocol";
import { parsePort, startHttpMcpServer, type HttpMcpServerOptions } from "./http";
import { startMcpServer } from "./stdio";

type McpTransportName = "stdio" | "http" | "streamable-http";

export interface McpBootstrapOptions {
  cwd: string;
  transport: McpTransportName;
  http: HttpMcpServerOptions;
}

type BootstrapEnv = Record<string, string | undefined>;

function cliOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);

  if (index < 0) {
    return undefined;
  }

  return argv[index + 1];
}

function resolveTransport(value: string | undefined): McpTransportName {
  const transport = value ?? "stdio";

  if (transport === "stdio" || transport === "http" || transport === "streamable-http") {
    return transport;
  }

  throw new Error(`Unsupported MCP transport: ${transport}. Expected one of: stdio, http, streamable-http`);
}

export function resolveMcpBootstrapOptions(
  argv: string[] = process.argv,
  env: BootstrapEnv = process.env,
): McpBootstrapOptions {
  const cwd = cliOption(argv, "--workspace") ?? env.KIWI_WORKSPACE ?? defaultServerCwd();
  const transport = resolveTransport(cliOption(argv, "--transport") ?? env.KIWI_MCP_TRANSPORT);
  const host = cliOption(argv, "--host");
  const port = cliOption(argv, "--port");
  const endpointPath = cliOption(argv, "--path");
  const http: HttpMcpServerOptions = { cwd };

  if (host) {
    http.host = host;
  }
  if (port) {
    http.port = parsePort(port, 3333);
  }
  if (endpointPath) {
    http.path = endpointPath;
  }
  if (env.KIWI_MCP_HTTP_TOKEN) {
    http.authToken = env.KIWI_MCP_HTTP_TOKEN;
  }

  return { cwd, transport, http };
}

export class McpServerBootstrap {
  start(options: McpBootstrapOptions = resolveMcpBootstrapOptions()): void {
    if (options.transport === "stdio") {
      startMcpServer(options.cwd);

      return;
    }

    startHttpMcpServer(options.http);
  }
}
