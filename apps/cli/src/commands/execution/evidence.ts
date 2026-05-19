import chalk from "chalk";
import { withRunLock } from "@kiwi/core";
import { writeEvidenceManifest } from "@kiwi/ops";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../../workspace/options.js";

interface EvidenceManifestOptions extends CliWorkspaceOptions {
  now?: Date;
}

export async function runEvidenceManifest(
  runId: string,
  opts: EvidenceManifestOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const result = await withRunLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: "evidence_manifest",
      now: opts.now,
    },
    () =>
      writeEvidenceManifest({
        cwd: workspace.workspacePath,
        runId,
        now: opts.now,
      }),
  );

  console.log(chalk.green("✓") + " Evidence manifest written");
  console.log(chalk.dim(`runId: ${runId}`));
  console.log(chalk.dim(`manifest: .kiwi/runs/${runId}/${result.manifestRef}`));
  console.log(chalk.dim(`audit: .kiwi/runs/${runId}/${result.auditSnapshotRef}`));
  console.log(chalk.dim(`files: ${result.manifest.files.length}`));
}
