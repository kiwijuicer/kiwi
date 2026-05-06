import { buildRunCompletionSummary } from "@kiwi/ops";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";
import { printCostSummary } from "./run-summary";

interface CostOptions extends CliWorkspaceOptions {
  json?: boolean;
  now?: Date;
}

export async function runCost(runId: string, opts: CostOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const summary = buildRunCompletionSummary({
    cwd: workspace.workspacePath,
    runId,
    ...(opts.now ? { now: opts.now } : {}),
  });

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printCostSummary(summary);
}
