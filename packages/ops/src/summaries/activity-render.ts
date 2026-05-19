import {
  ActivityTimelineChildModes,
  type ActivityTimelineChildMode,
  RunActivityStatuses,
  type ActivityTimelineRenderOptions,
  type RunActivityEntry,
  type RunActivityStatus,
  type RunActivityTimeline,
  type WorkspaceActivityTimeline,
} from "./activity-timeline-types.js";

const STATUS_MARKERS: Record<RunActivityStatus, string> = {
  [RunActivityStatuses.Pending]: "○",
  [RunActivityStatuses.Running]: "●",
  [RunActivityStatuses.Completed]: "✓",
  [RunActivityStatuses.Failed]: "!",
  [RunActivityStatuses.Blocked]: "■",
  [RunActivityStatuses.Skipped]: "-",
};

const ASCII_STATUS_MARKERS: Record<RunActivityStatus, string> = {
  [RunActivityStatuses.Pending]: "[todo]",
  [RunActivityStatuses.Running]: "[run]",
  [RunActivityStatuses.Completed]: "[done]",
  [RunActivityStatuses.Failed]: "[fail]",
  [RunActivityStatuses.Blocked]: "[blocked]",
  [RunActivityStatuses.Skipped]: "[skip]",
};

class ActivityTimelineMarkdownRenderer {
  private readonly ascii: boolean;
  private readonly includeChildren: ActivityTimelineChildMode;

  constructor(options: ActivityTimelineRenderOptions = {}) {
    this.ascii = options.ascii ?? false;
    this.includeChildren = options.includeChildren ?? ActivityTimelineChildModes.All;
  }

  treeLines(input: RunActivityTimeline): string[] {
    const byParent = new Map<string, RunActivityEntry[]>();
    const rootKey = "";

    for (const activity of input.activities) {
      const key = activity.parentActivityId ?? rootKey;
      byParent.set(key, [...(byParent.get(key) ?? []), activity]);
    }

    const render = (activity: RunActivityEntry, depth: number): string[] => {
      const indent = "  ".repeat(depth);
      const line = `${indent}${this.marker(activity.status)} ${activity.title}${this.metadataLine(activity)}`;
      const children = (byParent.get(activity.activityId) ?? []).filter((child) => this.shouldRenderChild(child));

      return [line, ...children.flatMap((child) => render(child, depth + 1))];
    };

    return (byParent.get(rootKey) ?? []).flatMap((activity) => render(activity, 0));
  }

  timelineMarkdown(input: RunActivityTimeline): string {
    return [
      `## Activity Timeline ${input.runId}`,
      "",
      `Summary: ${input.summary.completed}/${input.summary.total} completed, ${input.summary.running} running, ${input.summary.failed} failed, ${input.summary.blocked} blocked`,
      "",
      ...this.treeLines(input),
    ].join("\n");
  }

  workspaceMarkdown(input: WorkspaceActivityTimeline): string {
    return [
      "## Workspace Activity Timeline",
      "",
      `Runs: ${input.runs.length}`,
      `Summary: ${input.summary.completed}/${input.summary.total} completed, ${input.summary.running} running, ${input.summary.failed} failed, ${input.summary.blocked} blocked`,
      "",
      ...input.activities.map(
        (activity) =>
          `${this.marker(activity.status)} ${activity.runId} ${activity.title}${this.metadataLine(activity)}`,
      ),
    ].join("\n");
  }

  private marker(status: RunActivityStatus): string {
    return this.ascii ? ASCII_STATUS_MARKERS[status] : STATUS_MARKERS[status];
  }

  private metadataLine(activity: RunActivityEntry): string {
    const metadata = activity.metadata ?? {};
    const values = [
      typeof metadata.runner === "string" ? metadata.runner : null,
      typeof metadata.accessMode === "string" ? metadata.accessMode : null,
      typeof metadata.model === "string" ? metadata.model : null,
      typeof metadata.capability === "string" ? metadata.capability : null,
      typeof metadata.gateStatus === "string" ? `gates:${metadata.gateStatus}` : null,
      typeof metadata.verdict === "string" ? `review:${metadata.verdict}` : null,
      typeof metadata.reason === "string" ? metadata.reason : null,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    return values.length > 0 ? ` (${values.join(", ")})` : "";
  }

  private shouldRenderChild(activity: RunActivityEntry): boolean {
    return (
      this.includeChildren === ActivityTimelineChildModes.All ||
      activity.status === RunActivityStatuses.Running ||
      activity.status === RunActivityStatuses.Failed ||
      activity.status === RunActivityStatuses.Blocked
    );
  }
}

export function renderActivityTreeLines(
  input: RunActivityTimeline,
  options: ActivityTimelineRenderOptions = {},
): string[] {
  return new ActivityTimelineMarkdownRenderer(options).treeLines(input);
}

export function renderActivityTimelineMarkdown(
  input: RunActivityTimeline,
  options: ActivityTimelineRenderOptions = {},
): string {
  return new ActivityTimelineMarkdownRenderer(options).timelineMarkdown(input);
}

export function renderWorkspaceActivityTimelineMarkdown(
  input: WorkspaceActivityTimeline,
  options: ActivityTimelineRenderOptions = {},
): string {
  return new ActivityTimelineMarkdownRenderer(options).workspaceMarkdown(input);
}
