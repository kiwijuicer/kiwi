export { handleMcpRequest, handleMcpMessage, defaultServerCwd } from "./protocol";
export { createMcpMessageDrainer, startMcpServer } from "./stdio";
export { startHttpMcpServer, parsePort, type HttpMcpServerOptions } from "./http";
export { McpServerBootstrap, resolveMcpBootstrapOptions, type McpBootstrapOptions } from "./bootstrap";
export type { JsonRpcRequest, JsonRpcResponse } from "./json-rpc";

import { McpServerBootstrap } from "./bootstrap";

if (require.main === module) {
  new McpServerBootstrap().start();
}
