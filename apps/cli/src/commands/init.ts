import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import chalk from "chalk";
import {
  DEFAULT_MODEL_REGISTRY_YAML,
  DEFAULT_POLICY_YAML,
  defaultKiwiConfigYaml,
} from "../default-config";

export interface InitOptions {
  force?: boolean;
  workspace?: string;
  cursorMcp?: boolean;
}

interface McpServerLaunch {
  command: string;
  args: string[];
}

interface CursorMcpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

interface CursorMcpWriteResult {
  path: string;
  status: "written" | "updated" | "preserved";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kiwiRootCandidates(): string[] {
  return [
    path.resolve(__dirname, "../../.."),
    path.resolve(__dirname, "../../../.."),
  ];
}

function resolveKiwiRoot(): string {
  for (const candidate of kiwiRootCandidates()) {
    if (existsSync(path.join(candidate, "apps", "mcp-server", "src", "index.ts"))) {
      return candidate;
    }
  }

  return path.resolve(__dirname, "../../..");
}

function resolveMcpServerLaunch(): McpServerLaunch {
  const distCandidates = [
    path.resolve(__dirname, "../../mcp-server/dist/index.js"),
    path.resolve(__dirname, "../../../mcp-server/dist/index.js"),
    path.join(resolveKiwiRoot(), "apps", "mcp-server", "dist", "index.js"),
  ];

  for (const candidate of distCandidates) {
    if (existsSync(candidate)) {
      return {
        command: "node",
        args: [candidate],
      };
    }
  }

  return {
    command: "pnpm",
    args: ["--dir", resolveKiwiRoot(), "tsx", "apps/mcp-server/src/index.ts"],
  };
}

function desiredCursorMcpServer(): Record<string, unknown> {
  const launch = resolveMcpServerLaunch();
  return {
    command: launch.command,
    args: launch.args,
    env: {
      KIWI_WORKSPACE: "${workspaceFolder}",
    },
  };
}

function readCursorMcpConfig(configPath: string): CursorMcpConfig {
  if (!existsSync(configPath)) return {};

  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
  if (!isRecord(parsed)) {
    throw new Error(`Cursor MCP config must be a JSON object: ${configPath}`);
  }

  const config: CursorMcpConfig = { ...parsed };
  if (config.mcpServers !== undefined && !isRecord(config.mcpServers)) {
    throw new Error(`Cursor MCP config field mcpServers must be an object: ${configPath}`);
  }

  return config;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function writeCursorMcpConfig(targetCwd: string, force: boolean): CursorMcpWriteResult {
  const cursorDir = path.join(targetCwd, ".cursor");
  const configPath = path.join(cursorDir, "mcp.json");
  const existed = existsSync(configPath);
  const config = readCursorMcpConfig(configPath);
  const existingServers = config.mcpServers ?? {};
  const nextServer = desiredCursorMcpServer();

  if (!force && stableJson(existingServers.kiwi) === stableJson(nextServer)) {
    return { path: configPath, status: "preserved" };
  }

  mkdirSync(cursorDir, { recursive: true });
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

export async function runInit(
  opts: InitOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
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
  const cursorMcp = opts.cursorMcp === false
    ? null
    : writeCursorMcpConfig(targetCwd, Boolean(opts.force));

  console.log(chalk.green("✓") + " .kiwi initialized");
  console.log(chalk.dim(`workspace: ${targetCwd}`));
  if (!shouldWriteConfig) console.log(chalk.gray("•") + " .kiwi/config.yaml preserved");
  if (!shouldWritePolicy) console.log(chalk.gray("•") + " kiwi-policy.yaml preserved");
  if (!shouldWriteRegistry) console.log(chalk.gray("•") + " model-registry.yaml preserved");
  if (cursorMcp?.status === "preserved") console.log(chalk.gray("•") + " .cursor/mcp.json preserved");
  if (shouldWriteConfig) console.log(chalk.green("✓") + " .kiwi/config.yaml written");
  if (shouldWritePolicy) console.log(chalk.green("✓") + " kiwi-policy.yaml written");
  if (shouldWriteRegistry) console.log(chalk.green("✓") + " model-registry.yaml written");
  if (cursorMcp?.status === "written") console.log(chalk.green("✓") + " .cursor/mcp.json written");
  if (cursorMcp?.status === "updated") console.log(chalk.green("✓") + " .cursor/mcp.json updated");
}
