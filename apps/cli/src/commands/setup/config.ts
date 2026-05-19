import { existsSync } from "fs";
import path from "path";
import chalk from "chalk";
import { loadKiwiConfig, saveKiwiConfig } from "@kiwi/core";
import { resolveCliWorkspace, type CliWorkspaceOptions } from "../../workspace/options.js";

type ConfigSetApproverOptions = CliWorkspaceOptions;

export async function runConfigSetApprover(
  identity: string,
  opts: ConfigSetApproverOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const trimmed = identity.trim();

  if (!trimmed) {
    throw new Error("Approver identity must not be empty.");
  }
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const configPath = path.join(workspace.workspacePath, ".kiwi", "config.yaml");
  const existing = existsSync(configPath) ? loadKiwiConfig(configPath) : { version: "1" as const };
  const saved = saveKiwiConfig(configPath, {
    ...existing,
    approver: {
      ...existing.approver,
      identity: trimmed,
    },
  });

  console.log(chalk.green("✓") + " approver identity configured");
  console.log(chalk.dim(`workspace: ${workspace.workspacePath}`));
  console.log(chalk.dim(`identity: ${saved.approver?.identity ?? trimmed}`));
}
