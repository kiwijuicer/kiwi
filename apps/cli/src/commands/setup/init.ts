import { existsSync } from "fs";
import path from "path";
import chalk from "chalk";
import { GitignoreWriteStatuses } from "../../config/constants.js";
import { logMcpReadiness, McpConfigWriter, resolveMcpTargets } from "./init-mcp-config.js";
import { displayPath, GitignoreWriter, logConfigWrite, writeWorkspaceState } from "./init-workspace-state.js";

interface InitOptions {
  force?: boolean;
  workspace?: string;
  mcp?: string;
  env?: Record<string, string | undefined>;
}

async function runInitInternal(
  opts: InitOptions = {},
  cwd: string = process.cwd(),
  services: { mcpConfigWriter: McpConfigWriter; gitignoreWriter: GitignoreWriter } = {
    mcpConfigWriter: new McpConfigWriter(),
    gitignoreWriter: new GitignoreWriter(),
  },
): Promise<void> {
  const targetCwd = opts.workspace ? path.resolve(cwd, opts.workspace) : cwd;
  const env = opts.env ?? process.env;

  if (!existsSync(targetCwd)) {
    throw new Error(`Workspace path not found: ${targetCwd}`);
  }
  const mcpTargets = resolveMcpTargets(opts.mcp);
  const state = writeWorkspaceState({
    targetCwd,
    env,
    force: Boolean(opts.force),
    mcpTargets,
    gitignoreWriter: services.gitignoreWriter,
  });
  const cursorMcp = mcpTargets.has("cursor")
    ? services.mcpConfigWriter.writeCursor(targetCwd, Boolean(opts.force))
    : null;
  const claudeMcp = mcpTargets.has("claude")
    ? services.mcpConfigWriter.writeClaudeCode(targetCwd, Boolean(opts.force))
    : null;
  const codexMcp = mcpTargets.has("codex") ? services.mcpConfigWriter.writeCodex(targetCwd, Boolean(opts.force)) : null;

  console.log(chalk.green("✓") + " .kiwi initialized");
  console.log(chalk.dim(`workspace: ${targetCwd}`));
  console.log(chalk.dim(`kiwi home: ${state.homeDefaults.homePath}`));
  logConfigWrite(state.homeDefaults.policy, state.homeDefaults.policy.path);
  logConfigWrite(state.homeDefaults.registry, state.homeDefaults.registry.path);
  if (!state.shouldWriteConfig) {
    console.log(chalk.gray("•") + " .kiwi/config.yaml preserved");
  }
  if (state.shouldWriteConfig) {
    console.log(chalk.green("✓") + " .kiwi/config.yaml written");
  }
  if (state.approverIdentity.status === "written" || state.approverIdentity.status === "updated") {
    console.log(chalk.green("✓") + ` approver identity configured from git: ${state.approverIdentity.identity}`);
  }
  if (state.approverIdentity.status === "preserved") {
    console.log(chalk.gray("•") + ` approver identity preserved: ${state.approverIdentity.identity}`);
  }
  if (state.approverIdentity.status === "unavailable") {
    console.log(chalk.yellow("•") + " approver identity not configured; git user.email not found");
  }
  if (existsSync(state.policyPath)) {
    console.log(chalk.gray("•") + " .kiwi/policy.yaml preserved as workspace override");
  }
  if (existsSync(state.registryPath)) {
    console.log(chalk.gray("•") + " .kiwi/model-registry.yaml preserved as workspace override");
  }
  logConfigWrite(cursorMcp, ".cursor/mcp.json");
  logConfigWrite(claudeMcp, ".mcp.json");
  logConfigWrite(codexMcp, ".codex/config.toml");
  logMcpReadiness(mcpTargets, env);

  const ignoreDisplayPath = displayPath(targetCwd, state.gitignore.path);

  if (state.gitignore.status === GitignoreWriteStatuses.Updated) {
    console.log(chalk.green("✓") + ` ${ignoreDisplayPath} updated`);
  }
  if (state.gitignore.status === GitignoreWriteStatuses.Preserved) {
    console.log(chalk.gray("•") + ` ${ignoreDisplayPath} preserved`);
  }
}

class InitCommand {
  async run(opts: InitOptions = {}, cwd: string = process.cwd()): Promise<void> {
    await runInitInternal(opts, cwd);
  }
}

const initCommand = new InitCommand();

export async function runInit(opts: InitOptions = {}, cwd: string = process.cwd()): Promise<void> {
  await initCommand.run(opts, cwd);
}
