import { listRunIds, loadRunManifest } from "@kiwi/core";
import { buildRunActivityTimeline } from "./activity-timeline.js";
import { activitySummary, activityTimestamp, type WorkspaceActivityTimeline } from "./activity-timeline-types.js";

export function buildWorkspaceActivityTimeline(params: {
  cwd: string;
  repoId?: string;
  repoPath?: string;
  limit?: number;
  now?: Date;
}): WorkspaceActivityTimeline {
  const limit = params.limit ?? 10;
  const runs = listRunIds(params.cwd)
    .map((runId) => loadRunManifest(runId, params.cwd))
    .filter((run) => (params.repoId ? run.repoId === params.repoId : true))
    .filter((run) => (params.repoPath ? run.repoPath === params.repoPath : true))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
  const activities = runs
    .flatMap(
      (run) =>
        buildRunActivityTimeline({
          cwd: params.cwd,
          runId: run.runId,
          ...(params.now ? { now: params.now } : {}),
        }).activities,
    )
    .sort((left, right) => activityTimestamp(right).localeCompare(activityTimestamp(left)))
    .slice(0, limit * 25);

  return {
    schemaVersion: "1",
    generatedAt: (params.now ?? new Date()).toISOString(),
    summary: activitySummary(activities),
    runs: runs.map((run) => ({ runId: run.runId, status: run.status, updatedAt: run.updatedAt })),
    activities,
  };
}

export class WorkspaceActivityTimelineBuilder {
  build(params: Parameters<typeof buildWorkspaceActivityTimeline>[0]): WorkspaceActivityTimeline {
    return buildWorkspaceActivityTimeline(params);
  }
}
