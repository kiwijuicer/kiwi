export { handleMcpRequest, handleMcpMessage, defaultServerCwd } from "./server/protocol.js";
export { createMcpMessageDrainer, startMcpServer } from "./server/stdio.js";
export { startHttpMcpServer } from "./server/http.js";
export { McpServerBootstrap, resolveMcpBootstrapOptions } from "./server/bootstrap.js";

import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServerBootstrap, resolveMcpBootstrapOptions } from "./server/bootstrap.js";

function realpathOrOriginal(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

export function isMcpServerEntrypoint(entryArg: string | undefined, moduleUrl: string): boolean {
  if (!entryArg) {
    return false;
  }
  const entryFile = realpathOrOriginal(path.resolve(entryArg));
  const moduleFile = realpathOrOriginal(fileURLToPath(moduleUrl));

  return entryFile === moduleFile;
}

if (isMcpServerEntrypoint(process.argv[1], import.meta.url)) {
  const options = resolveMcpBootstrapOptions();
  console.error("Starting MCP server");
  new McpServerBootstrap(options).start();
}
