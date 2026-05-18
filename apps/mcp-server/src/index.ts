export { handleMcpRequest, handleMcpMessage, defaultServerCwd } from "./protocol";
export { createMcpMessageDrainer, startMcpServer } from "./stdio";
export { startHttpMcpServer } from "./http";
export { McpServerBootstrap, resolveMcpBootstrapOptions } from "./bootstrap";

import { McpServerBootstrap, resolveMcpBootstrapOptions } from "./bootstrap";

if (require.main === module) {
  const options = resolveMcpBootstrapOptions();
  console.error("Starting MCP server");
  new McpServerBootstrap(options).start();
}
