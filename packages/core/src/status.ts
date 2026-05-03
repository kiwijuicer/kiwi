import { RunManifest } from "@ai-kiwi/contracts";
import { listRunManifests } from "./run-store";

export interface RunStatusSummary {
  total: number;
  planned: number;
  running: number;
  needsApproval: number;
  completed: number;
  failed: number;
  cancelled: number;
  latest: RunManifest[];
}

export function getRunStatusSummary(cwd: string): RunStatusSummary {
  const runs = listRunManifests(cwd);

  return {
    total: runs.length,
    planned: runs.filter((run) => run.status === "planned").length,
    running: runs.filter((run) => run.status === "running").length,
    needsApproval: runs.filter((run) => run.status === "needs_approval").length,
    completed: runs.filter((run) => run.status === "completed").length,
    failed: runs.filter((run) => run.status === "failed").length,
    cancelled: runs.filter((run) => run.status === "cancelled").length,
    latest: runs.slice(0, 10),
  };
}
