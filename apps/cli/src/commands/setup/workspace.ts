import chalk from "chalk";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../../workspace/options";

export async function runWorkspaceList(opts: CliWorkspaceOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  console.log(chalk.bold("kiwi workspace"));
  console.log(`workspace: ${workspace.workspacePath}`);
  console.log(`repos: ${workspace.repos.length}`);
  for (const repo of workspace.repos) {
    const selected = workspace.repo?.path === repo.path ? " *" : "";
    console.log(`${repo.id}${selected}`);
    console.log(`  path: ${repo.path}`);
  }
}
