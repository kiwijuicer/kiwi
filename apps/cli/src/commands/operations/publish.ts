import chalk from "chalk";
import { withRunLock } from "@kiwi/core";
import { publishPrDraft } from "@kiwi/ops";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../../workspace/options.js";

interface PublishPrOptions extends CliWorkspaceOptions {
  remote?: string;
  targetBranch?: string;
  branchName?: string;
  now?: Date;
}

export async function runPublishPr(
  runId: string,
  opts: PublishPrOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const result = await withRunLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: "publish-pr",
      now: opts.now,
    },
    () => {
      const input: Parameters<typeof publishPrDraft>[0] = {
        cwd: workspace.workspacePath,
        runId,
      };

      if (opts.remote) {
        input.remote = opts.remote;
      }
      if (opts.targetBranch) {
        input.targetBranch = opts.targetBranch;
      }
      if (opts.branchName) {
        input.branchName = opts.branchName;
      }
      if (opts.now) {
        input.now = opts.now;
      }

      return publishPrDraft(input);
    },
  );

  console.log(chalk.green("✓") + " PR draft prepared");
  console.log(chalk.dim(`runId: ${runId}`));
  console.log(chalk.dim(`branch: ${result.prDraft.sourceBranch}`));
  console.log(chalk.dim(`draft: .kiwi/runs/${runId}/${result.prDraftRef}`));
  console.log(chalk.dim(`createUrl: ${result.prDraft.createUrl}`));
}
