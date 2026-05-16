export { handleMcpRequest, handleMcpMessage, defaultServerCwd } from "./protocol";
export { createMcpMessageDrainer, startMcpServer } from "./stdio";
export { startHttpMcpServer, parsePort, type HttpMcpServerOptions } from "./http";
export {
  McpServerBootstrap,
  resolveMcpBootstrapOptions,
  type McpBootstrapOptions,
  type McpServerBootstrapConfig,
} from "./bootstrap";
export type { JsonRpcRequest, JsonRpcResponse } from "./json-rpc";

import { McpServerBootstrap, resolveMcpBootstrapOptions } from "./bootstrap";

if (require.main === module) {
  const options = resolveMcpBootstrapOptions();
  console.error("Starting MCP server");
  new McpServerBootstrap(options).start();
}
