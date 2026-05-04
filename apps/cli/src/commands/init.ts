import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import chalk from "chalk";
import { DEFAULT_MODEL_REGISTRY_YAML, DEFAULT_POLICY_YAML, defaultKiwiConfigYaml } from "../default-config";

export interface InitOptions {
  force?: boolean;
  workspace?: string;
  cursorMcp?: boolean;
  claudeCodeMcp?: boolean;
  codexMcp?: boolean;
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

interface ConfigWriteResult {
  path: string;
  status: "written" | "updated" | "preserved";
}

interface GitignoreWriteResult {
  path: string;
  status: "updated" | "preserved" | "missing";
}

const KIWI_GITIGNORE_ENTRIES = [".kiwi/", ".cursor/mcp.json", ".mcp.json", ".codex/config.toml"];

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

function resolveMcpServerLaunch(workspaceValue: string): McpServerLaunch {
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

function desiredJsonMcpServer(workspaceValue: string): Record<string, unknown> {
  const launch = resolveMcpServerLaunch(workspaceValue);
  const server: Record<string, unknown> = {
    type: "stdio",
    command: launch.command,
    args: launch.args,
  };
  if (launch.env) server.env = launch.env;
  return server;
}

function readJsonMcpConfig(configPath: string, label: string): JsonMcpConfig {
  if (!existsSync(configPath)) return {};

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
}): ConfigWriteResult {
  const { configPath, directoryPath, label, workspaceValue, force } = params;
  const existed = existsSync(configPath);
  const config = readJsonMcpConfig(configPath, label);
  const existingServers = config.mcpServers ?? {};
  const nextServer = desiredJsonMcpServer(workspaceValue);

  if (!force && stableJson(existingServers.kiwi) === stableJson(nextServer)) {
    return { path: configPath, status: "preserved" };
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

  return { path: configPath, status: existed ? "updated" : "written" };
}

function writeCursorMcpConfig(targetCwd: string, force: boolean): ConfigWriteResult {
  const cursorDir = path.join(targetCwd, ".cursor");
  return writeJsonMcpConfig({
    configPath: path.join(cursorDir, "mcp.json"),
    directoryPath: cursorDir,
    label: "Cursor",
    workspaceValue: targetCwd,
    force,
  });
}

function writeClaudeCodeMcpConfig(targetCwd: string, force: boolean): ConfigWriteResult {
  return writeJsonMcpConfig({
    configPath: path.join(targetCwd, ".mcp.json"),
    directoryPath: targetCwd,
    label: "Claude Code",
    workspaceValue: targetCwd,
    force,
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

function desiredCodexMcpBlock(targetCwd: string): string {
  const launch = resolveMcpServerLaunch(targetCwd);
  const lines = ["[mcp_servers.kiwi]", `command = ${tomlString(launch.command)}`, `args = ${tomlArray(launch.args)}`];
  if (launch.env) lines.push(`env = ${tomlInlineTable(launch.env)}`);
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

function writeCodexMcpConfig(targetCwd: string, force: boolean): ConfigWriteResult {
  const codexDir = path.join(targetCwd, ".codex");
  const configPath = path.join(codexDir, "config.toml");
  const existed = existsSync(configPath);
  const current = existed ? readFileSync(configPath, "utf-8") : "";
  const next = upsertTomlTable(current, "mcp_servers.kiwi", desiredCodexMcpBlock(targetCwd));

  if (!force && current === next) {
    return { path: configPath, status: "preserved" };
  }

  mkdirSync(codexDir, { recursive: true });
  writeFileSync(configPath, next, "utf-8");
  return { path: configPath, status: existed ? "updated" : "written" };
}

function logConfigWrite(result: ConfigWriteResult | null, displayPath: string): void {
  if (result?.status === "preserved") console.log(chalk.gray("•") + ` ${displayPath} preserved`);
  if (result?.status === "written") console.log(chalk.green("✓") + ` ${displayPath} written`);
  if (result?.status === "updated") console.log(chalk.green("✓") + ` ${displayPath} updated`);
}

function normalizeGitignoreLine(line: string): string {
  return line.trim().replace(/^\//, "");
}

function writeGitignoreEntries(targetCwd: string): GitignoreWriteResult {
  const gitignorePath = path.join(targetCwd, ".gitignore");
  if (!existsSync(gitignorePath)) {
    return { path: gitignorePath, status: "missing" };
  }

  const current = readFileSync(gitignorePath, "utf-8");
  const existing = new Set(
    current
      .split(/\r?\n/)
      .map(normalizeGitignoreLine)
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  const missing = KIWI_GITIGNORE_ENTRIES.filter((entry) => !existing.has(normalizeGitignoreLine(entry)));

  if (missing.length === 0) {
    return { path: gitignorePath, status: "preserved" };
  }

  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  writeFileSync(gitignorePath, `${current}${separator}${missing.join("\n")}\n`, "utf-8");
  return { path: gitignorePath, status: "updated" };
}

export async function runInit(opts: InitOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const targetCwd = opts.workspace ? path.resolve(cwd, opts.workspace) : cwd;
  if (!existsSync(targetCwd)) {
    throw new Error(`Workspace path not found: ${targetCwd}`);
  }
  const kiwiDir = path.join(targetCwd, ".kiwi");
  const configPath = path.join(kiwiDir, "config.yaml");
  const policyPath = path.join(targetCwd, "kiwi-policy.yaml");
  const registryPath = path.join(targetCwd, "model-registry.yaml");

  mkdirSync(path.join(kiwiDir, "runs"), { recursive: true });
  mkdirSync(path.join(kiwiDir, "logs"), { recursive: true });

  const shouldWriteConfig = !existsSync(configPath) || Boolean(opts.force);
  if (shouldWriteConfig) {
    writeFileSync(configPath, defaultKiwiConfigYaml(new Date().toISOString()), "utf-8");
  }

  const shouldWritePolicy = !existsSync(policyPath) || Boolean(opts.force);
  const shouldWriteRegistry = !existsSync(registryPath) || Boolean(opts.force);

  if (shouldWritePolicy) {
    writeFileSync(policyPath, DEFAULT_POLICY_YAML, "utf-8");
  }
  if (shouldWriteRegistry) {
    writeFileSync(registryPath, DEFAULT_MODEL_REGISTRY_YAML, "utf-8");
  }
  const cursorMcp = opts.cursorMcp === false ? null : writeCursorMcpConfig(targetCwd, Boolean(opts.force));
  const claudeCodeMcp = opts.claudeCodeMcp === false ? null : writeClaudeCodeMcpConfig(targetCwd, Boolean(opts.force));
  const codexMcp = opts.codexMcp === false ? null : writeCodexMcpConfig(targetCwd, Boolean(opts.force));
  const gitignore = writeGitignoreEntries(targetCwd);

  console.log(chalk.green("✓") + " .kiwi initialized");
  console.log(chalk.dim(`workspace: ${targetCwd}`));
  if (!shouldWriteConfig) console.log(chalk.gray("•") + " .kiwi/config.yaml preserved");
  if (!shouldWritePolicy) console.log(chalk.gray("•") + " kiwi-policy.yaml preserved");
  if (!shouldWriteRegistry) console.log(chalk.gray("•") + " model-registry.yaml preserved");
  if (shouldWriteConfig) console.log(chalk.green("✓") + " .kiwi/config.yaml written");
  if (shouldWritePolicy) console.log(chalk.green("✓") + " kiwi-policy.yaml written");
  if (shouldWriteRegistry) console.log(chalk.green("✓") + " model-registry.yaml written");
  logConfigWrite(cursorMcp, ".cursor/mcp.json");
  logConfigWrite(claudeCodeMcp, ".mcp.json");
  logConfigWrite(codexMcp, ".codex/config.toml");
  if (gitignore.status === "updated") console.log(chalk.green("✓") + " .gitignore updated");
  if (gitignore.status === "preserved") console.log(chalk.gray("•") + " .gitignore preserved");
}
