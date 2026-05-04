#!/usr/bin/env node

const { appendFileSync, mkdirSync } = require("fs");
const path = require("path");

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

const workspace = option("--workspace") || process.env.KIWI_WORKSPACE || process.cwd();
const debugLog =
  option("--debug-log") || process.env.KIWI_MCP_DEBUG_LOG || path.join(workspace, ".kiwi", "logs", "mcp-debug.log");
const serverPath = option("--server") || path.join(__dirname, "..", "dist", "index.js");

function log(message, details = {}) {
  mkdirSync(path.dirname(debugLog), { recursive: true });
  appendFileSync(
    debugLog,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      message,
      ...details,
    })}\n`,
    "utf-8",
  );
}

process.env.KIWI_WORKSPACE = workspace;
process.env.KIWI_MCP_DEBUG_LOG = debugLog;

log("launcher_start", {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  node: process.execPath,
  workspace,
  serverPath,
  pid: process.pid,
});

try {
  const server = require(serverPath);
  if (typeof server.startMcpServer !== "function") {
    throw new Error("startMcpServer export not found");
  }
  server.startMcpServer(workspace);
} catch (error) {
  log("launcher_error", {
    error: error instanceof Error ? error.stack || error.message : String(error),
  });
  process.exitCode = 1;
}
