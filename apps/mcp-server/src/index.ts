export { handleMcpRequest, handleMcpMessage, defaultServerCwd } from "./server/protocol";
export { createMcpMessageDrainer, startMcpServer } from "./server/stdio";
export { startHttpMcpServer } from "./server/http";
export { McpServerBootstrap, resolveMcpBootstrapOptions } from "./server/bootstrap";

import { McpServerBootstrap, resolveMcpBootstrapOptions } from "./server/bootstrap";

if (require.main === module) {
  const options = resolveMcpBootstrapOptions();
  console.error("Starting MCP server");
  new McpServerBootstrap(options).start();
}
