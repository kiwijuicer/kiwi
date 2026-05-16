export { handleMcpRequest, handleMcpMessage, defaultServerCwd } from "./protocol";
export { createMcpMessageDrainer, startMcpServer } from "./stdio";
export { startHttpMcpServer, parsePort, type HttpMcpServerOptions } from "./http";
export type { JsonRpcRequest, JsonRpcResponse } from "./json-rpc";

import { defaultServerCwd } from "./protocol";
import { parsePort, startHttpMcpServer, type HttpMcpServerOptions } from "./http";
import { startMcpServer } from "./stdio";

function cliOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  if (index < 0) {
    return undefined;
  }

  return process.argv[index + 1];
}

if (require.main === module) {
  const cwd = cliOption("--workspace") ?? defaultServerCwd();
  const transport = cliOption("--transport") ?? process.env.KIWI_MCP_TRANSPORT ?? "stdio";

  if (transport === "http" || transport === "streamable-http") {
    const options: HttpMcpServerOptions = { cwd };
    const host = cliOption("--host");
    const port = cliOption("--port");
    const endpointPath = cliOption("--path");

    if (host) {
      options.host = host;
    }
    if (port) {
      options.port = parsePort(port, 3333);
    }
    if (endpointPath) {
      options.path = endpointPath;
    }
    startHttpMcpServer(options);
  } else {
    startMcpServer(cwd);
  }
}
