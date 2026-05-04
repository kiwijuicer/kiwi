import chalk from "chalk";
import { withRunLock, writeEvidenceManifest } from "@ai-kiwi/core";

export interface EvidenceManifestOptions {
  now?: Date;
}

export async function runEvidenceManifest(
  runId: string,
  opts: EvidenceManifestOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const result = await withRunLock(
    {
      cwd,
      runId,
      operation: "evidence_manifest",
      now: opts.now,
    },
    () =>
      writeEvidenceManifest({
        cwd,
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
