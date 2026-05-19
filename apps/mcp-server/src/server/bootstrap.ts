import { KiwiRunnerEnvVars } from "@kiwi/contracts";
import { defaultServerCwd } from "./protocol.js";
import { parsePort, startHttpMcpServer, type HttpMcpServerOptions } from "./http.js";
import { startMcpServer } from "./stdio.js";
import { McpTransportNames, type McpTransportName } from "../constants.js";

interface McpBootstrapOptions {
  cwd: string;
  transport: McpTransportName;
  http: HttpMcpServerOptions;
  runnerActive: boolean;
}

type BootstrapEnv = Record<string, string | undefined>;

interface McpServerBootstrapTransports {
  startStdio(cwd: string): void;
  startHttp(options: HttpMcpServerOptions): unknown;
}

interface McpServerBootstrapConfig {
  transports?: Partial<McpServerBootstrapTransports>;
  stderr?: { write(message: string): unknown };
}

function cliOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);

  if (index < 0) {
    return undefined;
  }

  return argv[index + 1];
}

function resolveTransport(value: string | undefined): McpTransportName {
  const transport = value ?? McpTransportNames.Stdio;

  if (Object.values(McpTransportNames).includes(transport as McpTransportName)) {
    return transport as McpTransportName;
  }

  throw new Error(`Unsupported MCP transport: ${transport}. Expected one of: stdio, http`);
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

  return { cwd, transport, http, runnerActive: env[KiwiRunnerEnvVars.Active] === "1" };
}

export class McpServerBootstrap {
  private readonly options: McpBootstrapOptions;
  private readonly transports: McpServerBootstrapTransports;
  private readonly stderr: { write(message: string): unknown };

  constructor(options: McpBootstrapOptions, config: McpServerBootstrapConfig = {}) {
    this.options = options;
    this.transports = {
      startStdio: config.transports?.startStdio ?? startMcpServer,
      startHttp: config.transports?.startHttp ?? startHttpMcpServer,
    };
    this.stderr = config.stderr ?? process.stderr;
  }

  start(): void {
    if (this.options.transport === McpTransportNames.Stdio) {
      if (this.options.runnerActive) {
        this.stderr.write("kiwi MCP disabled inside kiwi runner process\n");

        return;
      }

      this.transports.startStdio(this.options.cwd);

      return;
    }

    this.transports.startHttp(this.options.http);
  }
}
