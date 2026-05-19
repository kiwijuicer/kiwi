import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import chalk from "chalk";
import {
  type ConfigWriteStatus,
  ConfigWriteStatuses,
  type McpInitTarget,
  McpInitTargets,
} from "../../config/constants";

export type ConcreteMcpTarget = Exclude<McpInitTarget, typeof McpInitTargets.None | typeof McpInitTargets.All>;

interface ConfigWriteResult {
  path: string;
  status: ConfigWriteStatus;
}

interface McpServerLaunch {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface JsonMcpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export const MCP_GITIGNORE_ENTRIES: Record<ConcreteMcpTarget, string> = {
  cursor: ".cursor/mcp.json",
  claude: ".mcp.json",
  codex: ".codex/config.toml",
};
const ORDERED_MCP_TARGETS: ConcreteMcpTarget[] = [McpInitTargets.Cursor, McpInitTargets.Claude, McpInitTargets.Codex];

const MCP_CLIENT_READINESS: Record<
  ConcreteMcpTarget,
  { label: string; binary: string; configPath: string; missingFix: string; readyFix: string }
> = {
  cursor: {
    label: "Cursor",
    binary: "cursor",
    configPath: ".cursor/mcp.json",
    missingFix: "Install Cursor or add the cursor CLI to PATH, then reload Cursor MCP tools.",
    readyFix: "Reload Cursor MCP tools or restart the Cursor window.",
  },
  claude: {
    label: "Claude Code",
    binary: "claude",
    configPath: ".mcp.json",
    missingFix: "Install Claude Code, run `claude` and log in, then reload Claude MCP tools.",
    readyFix: "Run `claude mcp list` or restart Claude Code.",
  },
  codex: {
    label: "Codex",
    binary: "codex",
    configPath: ".codex/config.toml",
    missingFix: "Install Codex CLI, run `codex login`, then reload Codex MCP tools.",
    readyFix: "Run `codex mcp list` or restart Codex.",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kiwiRootCandidates(): string[] {
  return [path.resolve(__dirname, "../../.."), path.resolve(__dirname, "../../../..")];
}

function resolveKiwiRoot(): string {
  for (const candidate of kiwiRootCandidates()) {
    if (existsSync(path.join(candidate, "apps", "mcp-server", "src", "index.ts"))) {
      return candidate;
    }
  }

  return path.resolve(__dirname, "../../..");
}

function resolveInstalledMcpBin(): string | null {
  const configured = process.env.KIWI_MCP_BIN;

  if (!configured) {
    return null;
  }
  const resolved = path.resolve(configured);

  return existsSync(resolved) ? resolved : null;
}

function resolveMcpServerLaunch(workspaceValue: string): McpServerLaunch {
  const installedMcpBin = resolveInstalledMcpBin();

  if (installedMcpBin) {
    return {
      command: installedMcpBin,
      args: ["--workspace", workspaceValue],
    };
  }

  const distCandidates = [
    path.resolve(__dirname, "../../mcp-server/dist/index.js"),
    path.resolve(__dirname, "../../../mcp-server/dist/index.js"),
    path.join(resolveKiwiRoot(), "apps", "mcp-server", "dist", "index.js"),
  ];

  for (const candidate of distCandidates) {
    if (existsSync(candidate)) {
      const launcher = path.join(path.dirname(path.dirname(candidate)), "bin", "stdio-launcher.cjs");

      if (existsSync(launcher)) {
        return {
          command: process.execPath,
          args: [launcher, "--server", candidate, "--workspace", workspaceValue],
        };
      }

      return {
        command: process.execPath,
        args: [candidate],
        env: { KIWI_WORKSPACE: workspaceValue },
      };
    }
  }

  return {
    command: "pnpm",
    args: ["--dir", resolveKiwiRoot(), "tsx", "apps/mcp-server/src/index.ts"],
    env: { KIWI_WORKSPACE: workspaceValue },
  };
}

function desiredJsonMcpServer(
  workspaceValue: string,
  launch: McpServerLaunch = resolveMcpServerLaunch(workspaceValue),
): Record<string, unknown> {
  const server: Record<string, unknown> = {
    type: "stdio",
    command: launch.command,
    args: launch.args,
  };

  if (launch.env) {
    server.env = launch.env;
  }

  return server;
}

function readJsonMcpConfig(configPath: string, label: string): JsonMcpConfig {
  if (!existsSync(configPath)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));

  if (!isRecord(parsed)) {
    throw new Error(`${label} MCP config must be a JSON object: ${configPath}`);
  }
  const config: JsonMcpConfig = { ...parsed };

  if (config.mcpServers !== undefined && !isRecord(config.mcpServers)) {
    throw new Error(`${label} MCP config field mcpServers must be an object: ${configPath}`);
  }

  return config;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function writeJsonMcpConfig(params: {
  configPath: string;
  directoryPath: string;
  label: string;
  workspaceValue: string;
  force: boolean;
  nextServer?: Record<string, unknown>;
}): ConfigWriteResult {
  const { configPath, directoryPath, label, workspaceValue, force } = params;
  const existed = existsSync(configPath);
  const config = readJsonMcpConfig(configPath, label);
  const existingServers = config.mcpServers ?? {};
  const nextServer = params.nextServer ?? desiredJsonMcpServer(workspaceValue);

  if (!force && stableJson(existingServers.kiwi) === stableJson(nextServer)) {
    return { path: configPath, status: ConfigWriteStatuses.Preserved };
  }

  mkdirSync(directoryPath, { recursive: true });
  writeFileSync(
    configPath,
    `${stableJson({
      ...config,
      mcpServers: {
        ...existingServers,
        kiwi: nextServer,
      },
    })}\n`,
    "utf-8",
  );

  return { path: configPath, status: existed ? ConfigWriteStatuses.Updated : ConfigWriteStatuses.Written };
}

function writeCursorMcpConfig(
  targetCwd: string,
  force: boolean,
  nextServer: Record<string, unknown> = desiredJsonMcpServer(targetCwd),
): ConfigWriteResult {
  const cursorDir = path.join(targetCwd, ".cursor");

  return writeJsonMcpConfig({
    configPath: path.join(cursorDir, "mcp.json"),
    directoryPath: cursorDir,
    label: "Cursor",
    workspaceValue: targetCwd,
    force,
    nextServer,
  });
}

function writeClaudeCodeMcpConfig(
  targetCwd: string,
  force: boolean,
  nextServer: Record<string, unknown> = desiredJsonMcpServer(targetCwd),
): ConfigWriteResult {
  return writeJsonMcpConfig({
    configPath: path.join(targetCwd, ".mcp.json"),
    directoryPath: targetCwd,
    label: "Claude Code",
    workspaceValue: targetCwd,
    force,
    nextServer,
  });
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tomlArray(values: string[]): string {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

function tomlInlineTable(values: Record<string, string>): string {
  return `{ ${Object.entries(values)
    .map(([key, value]) => `${key} = ${tomlString(value)}`)
    .join(", ")} }`;
}

function desiredCodexMcpBlock(targetCwd: string, launch: McpServerLaunch = resolveMcpServerLaunch(targetCwd)): string {
  const lines = ["[mcp_servers.kiwi]", `command = ${tomlString(launch.command)}`, `args = ${tomlArray(launch.args)}`];

  if (launch.env) {
    lines.push(`env = ${tomlInlineTable(launch.env)}`);
  }

  return lines.join("\n");
}

function upsertTomlTable(existing: string, tableName: string, block: string): string {
  const lines = existing.split(/\r?\n/);
  const tableHeader = `[${tableName}]`;
  const start = lines.findIndex((line) => line.trim() === tableHeader);

  if (start === -1) {
    const prefix = existing.trim().length > 0 ? `${existing.replace(/\s*$/, "")}\n\n` : "";

    return `${prefix}${block}\n`;
  }

  let end = lines.length;

  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[.+\]\s*$/.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }

  const next = [...lines.slice(0, start), ...block.split("\n"), ...lines.slice(end)].join("\n");

  return `${next.replace(/\s*$/, "")}\n`;
}

function writeCodexMcpConfig(
  targetCwd: string,
  force: boolean,
  block: string = desiredCodexMcpBlock(targetCwd),
): ConfigWriteResult {
  const codexDir = path.join(targetCwd, ".codex");
  const configPath = path.join(codexDir, "config.toml");
  const existed = existsSync(configPath);
  const current = existed ? readFileSync(configPath, "utf-8") : "";
  const next = upsertTomlTable(current, "mcp_servers.kiwi", block);

  if (!force && current === next) {
    return { path: configPath, status: ConfigWriteStatuses.Preserved };
  }

  mkdirSync(codexDir, { recursive: true });
  writeFileSync(configPath, next, "utf-8");

  return { path: configPath, status: existed ? ConfigWriteStatuses.Updated : ConfigWriteStatuses.Written };
}

function selectedProbeEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  };
}

function binaryOnPath(binary: string, env: Record<string, string | undefined>): boolean {
  if (env.KIWI_FAKE_BINARY_AVAILABLE === "1") {
    return true;
  }
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [binary], {
      stdio: "ignore",
      env: selectedProbeEnv(env),
    });

    return true;
  } catch {
    return false;
  }
}

export function resolveMcpTargets(target: string | undefined): Set<ConcreteMcpTarget> {
  const value = target ?? McpInitTargets.All;

  if (value === McpInitTargets.None) {
    return new Set();
  }
  if (value === McpInitTargets.All) {
    return new Set(ORDERED_MCP_TARGETS);
  }
  if (value === McpInitTargets.Cursor || value === McpInitTargets.Claude || value === McpInitTargets.Codex) {
    return new Set([value]);
  }
  throw new Error(`Invalid MCP target: ${value}. Expected one of: none, cursor, claude, codex, all`);
}

export function logMcpReadiness(mcpTargets: Set<ConcreteMcpTarget>, env: Record<string, string | undefined>): void {
  if (mcpTargets.size === 0) {
    console.log(chalk.gray("•") + " MCP config skipped (--mcp none)");

    return;
  }

  console.log(chalk.bold("\nMCP client readiness:"));
  for (const target of ORDERED_MCP_TARGETS) {
    if (!mcpTargets.has(target)) {
      continue;
    }
    const client = MCP_CLIENT_READINESS[target];
    const ready = binaryOnPath(client.binary, env);
    const status = ready ? chalk.green("available") : chalk.yellow("not detected");
    const next = ready ? client.readyFix : client.missingFix;
    console.log(`  ${client.label.padEnd(12)} ${status} ${chalk.dim(client.configPath)}`);
    console.log(`    next: ${next}`);
  }
  console.log(chalk.dim("  Run `kiwi doctor` for model runner and auth readiness."));
}

class McpLaunchResolver {
  resolve(workspaceValue: string): McpServerLaunch {
    return resolveMcpServerLaunch(workspaceValue);
  }

  desiredJsonServer(
    workspaceValue: string,
    launch: McpServerLaunch = this.resolve(workspaceValue),
  ): Record<string, unknown> {
    return desiredJsonMcpServer(workspaceValue, launch);
  }

  desiredCodexBlock(targetCwd: string, launch: McpServerLaunch = this.resolve(targetCwd)): string {
    return desiredCodexMcpBlock(targetCwd, launch);
  }
}

export class McpConfigWriter {
  constructor(private readonly launchResolver = new McpLaunchResolver()) {}

  writeCursor(targetCwd: string, force: boolean): ConfigWriteResult {
    const launch = this.launchResolver.resolve(targetCwd);

    return writeCursorMcpConfig(targetCwd, force, this.launchResolver.desiredJsonServer(targetCwd, launch));
  }

  writeClaudeCode(targetCwd: string, force: boolean): ConfigWriteResult {
    const launch = this.launchResolver.resolve(targetCwd);

    return writeClaudeCodeMcpConfig(targetCwd, force, this.launchResolver.desiredJsonServer(targetCwd, launch));
  }

  writeCodex(targetCwd: string, force: boolean): ConfigWriteResult {
    const launch = this.launchResolver.resolve(targetCwd);

    return writeCodexMcpConfig(targetCwd, force, this.launchResolver.desiredCodexBlock(targetCwd, launch));
  }
}
