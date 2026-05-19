import { Command } from "commander/esm.mjs";
import { registerCoreCommands } from "./commands/registration/core.js";
import { registerExecutionCommands } from "./commands/registration/execution.js";

const program = new Command();

function buildVersionString(): string {
  const pkgVersion = "1.0.0";
  const sha = process.env.KIWI_BUILD_SHA;

  if (sha && sha.length > 0 && sha !== "unknown") {
    return `${pkgVersion} (${sha})`;
  }

  return pkgVersion;
}

program
  .name("kiwi")
  .description("kiwi local-first control plane")
  .version(buildVersionString())
  .option("--workspace <path>", "Workspace control root")
  .option("--repo <idOrPath>", "Target repo inside the workspace");

function withGlobalWorkspaceOptions<T extends { workspace?: string; repo?: string }>(opts: T): T {
  const global = program.opts<{ workspace?: string; repo?: string }>();
  const merged: T = { ...opts };
  const workspace = opts.workspace ?? global.workspace;
  const repo = opts.repo ?? global.repo;

  if (workspace) {
    merged.workspace = workspace;
  }
  if (repo) {
    merged.repo = repo;
  }

  return merged;
}

registerCoreCommands(program, withGlobalWorkspaceOptions);
registerExecutionCommands(program, withGlobalWorkspaceOptions);

program.parse();
