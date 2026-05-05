import { Command } from "commander";

export type WorkspaceOptionMerger = <T extends { workspace?: string; repo?: string }>(opts: T) => T;

export function addWorkspaceOptions(command: Command): Command {
  return command
    .option("--workspace <path>", "Workspace control root")
    .option("--repo <idOrPath>", "Target repo inside the workspace");
}

export function handleCommandError(error: Error): never {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}
