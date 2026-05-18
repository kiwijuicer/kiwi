import { Command } from "commander";
import chalk from "chalk";
import { BudgetExceededError, NotInitializedError, RunNotFoundError } from "@kiwi/core";

export type WorkspaceOptionMerger = <T extends { workspace?: string; repo?: string }>(opts: T) => T;

export function addWorkspaceOptions(command: Command): Command {
  return command
    .option("--workspace <path>", "Workspace control root")
    .option("--repo <idOrPath>", "Target repo inside the workspace");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code === code
  );
}

export function mapErrorToHelp(error: unknown): string | null {
  if (error instanceof NotInitializedError) {
    return "Run `kiwi init [--workspace ...]`.";
  }
  if (error instanceof RunNotFoundError) {
    return "List runs with `kiwi status` or pick a different `runId`.";
  }
  if (error instanceof BudgetExceededError) {
    return "Increase `--budget-profile` or relax risk profile.";
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("No real planner model") || message.includes("No enabled planner model")) {
    return "Run `kiwi doctor`, then log in/configure a real planner. Use `--allow-stub` only for tests/dev.";
  }
  if (message.includes("No reviewer model with an available access mode")) {
    return "Check `~/.kiwi/defaults/model-registry.yaml` and any workspace `.kiwi/model-registry.yaml` override, then run `kiwi doctor`.";
  }
  if (hasErrorCode(error, "provider_auth")) {
    return "Run `claude` and `/login` (or `codex login` / `cursor-agent status`).";
  }

  return null;
}

export function handleCommandError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n✗ ${message}`);
  const hint = mapErrorToHelp(error);

  if (hint) {
    console.error(chalk.yellow(`  hint: ${hint}`));
  } else if (process.argv.includes("--debug") && error instanceof Error && error.stack) {
    console.error(chalk.dim(error.stack));
  }
  process.exit(1);
}
