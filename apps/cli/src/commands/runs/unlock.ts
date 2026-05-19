import chalk from "chalk";
import { forceReleaseRunLock, loadKiwiConfig, RunLockBusyError } from "@kiwi/core";
import path from "path";
import { existsSync } from "fs";
import { resolveCliWorkspace, type CliWorkspaceOptions } from "../../workspace/options.js";

interface UnlockOptions extends CliWorkspaceOptions {
  force?: boolean;
  approvedBy?: string;
}

function configuredApprover(workspacePath: string): string | null {
  const configPath = path.join(workspacePath, ".kiwi", "config.yaml");

  if (!existsSync(configPath)) {
    return null;
  }

  return loadKiwiConfig(configPath).approver?.identity ?? null;
}

function resolveApprovedBy(opts: UnlockOptions, workspacePath: string): string {
  const identity = opts.approvedBy ?? process.env.KIWI_MCP_APPROVED_BY ?? configuredApprover(workspacePath);

  if (!identity?.trim()) {
    throw new Error("Unlock requires --approved-by, KIWI_MCP_APPROVED_BY, or config approver.identity.");
  }

  return identity.trim();
}

export async function runUnlock(runId: string, opts: UnlockOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const approvedBy = resolveApprovedBy(opts, workspace.workspacePath);

  try {
    const result = forceReleaseRunLock({
      cwd: workspace.workspacePath,
      runId,
      force: opts.force === true,
      approvedBy,
    });

    if (!result.existed) {
      console.log(chalk.gray("•") + ` no lock present for ${runId}`);

      return;
    }
    console.log(chalk.green("✓") + ` run lock released for ${runId}`);
    console.log(chalk.dim(`stale: ${String(result.stale)}`));
    console.log(chalk.dim(`forced: ${String(result.forced)}`));
  } catch (error) {
    if (error instanceof RunLockBusyError) {
      throw new Error(`Run lock owner is still alive. Re-run with --force only after confirming it is safe.`);
    }
    throw error;
  }
}
