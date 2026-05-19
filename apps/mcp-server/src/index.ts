export { handleMcpRequest, handleMcpMessage, defaultServerCwd } from "./server/protocol.js";
export { createMcpMessageDrainer, startMcpServer } from "./server/stdio.js";
export { startHttpMcpServer } from "./server/http.js";
export { McpServerBootstrap, resolveMcpBootstrapOptions } from "./server/bootstrap.js";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServerBootstrap, resolveMcpBootstrapOptions } from "./server/bootstrap.js";

const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
const moduleFile = fileURLToPath(import.meta.url);

if (entryFile === moduleFile) {
  const options = resolveMcpBootstrapOptions();
  console.error("Starting MCP server");
  new McpServerBootstrap(options).start();
}
