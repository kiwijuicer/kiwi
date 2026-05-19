import { mkdirSync, renameSync, writeFileSync } from "fs";
import path from "path";
import {
  appendAuditEvent,
  ensureRunLayout,
  getRunStatusSummary,
  loadInitiative,
  loadRunManifest,
  loadTaskGraph,
  resolveRunArtifactPath,
} from "@kiwi/core";
import { buildRunActivityTimeline } from "../summaries/activity-timeline.js";
import {
  RunActivityStatuses,
  type RunActivityEntry,
  type RunActivityStatus,
} from "../summaries/activity-timeline-types.js";

export interface OperatorSnapshotResult {
  runId: string;
  ref: string;
  generatedAt: string;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function writeTextSafely(target: string, value: string): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, value, "utf-8");
  renameSync(tempPath, target);
}

function renderList(items: string[]): string {
  if (items.length === 0) {
    return "<li>none</li>";
  }

  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

const ACTIVITY_MARKERS: Record<RunActivityStatus, string> = {
  [RunActivityStatuses.Pending]: "○",
  [RunActivityStatuses.Running]: "●",
  [RunActivityStatuses.Completed]: "✓",
  [RunActivityStatuses.Failed]: "!",
  [RunActivityStatuses.Blocked]: "■",
  [RunActivityStatuses.Skipped]: "-",
};

class OperatorSnapshotActivityRenderer {
  constructor(private readonly activities: RunActivityEntry[]) {}

  render(parentActivityId?: string): string {
    const children = this.activities.filter((activity) => activity.parentActivityId === parentActivityId);

    if (children.length === 0) {
      return "";
    }

    return `<ol class="${parentActivityId ? "activity-children" : "activity-timeline"}">${children
      .map((activity) => {
        const metadata = this.metadataText(activity);

        return `<li class="activity activity-${escapeHtml(activity.status)}"><span class="activity-marker">${escapeHtml(ACTIVITY_MARKERS[activity.status])}</span><span class="activity-main"><span class="activity-title">${escapeHtml(activity.title)}</span>${
          metadata ? `<span class="activity-meta">${escapeHtml(metadata)}</span>` : ""
        }</span>${this.render(activity.activityId)}</li>`;
      })
      .join("")}</ol>`;
  }

  private metadataText(activity: RunActivityEntry): string {
    const metadata = activity.metadata ?? {};
    const values = [
      typeof metadata.runner === "string" ? metadata.runner : null,
      typeof metadata.accessMode === "string" ? metadata.accessMode : null,
      typeof metadata.model === "string" ? metadata.model : null,
      typeof metadata.capability === "string" ? metadata.capability : null,
      typeof metadata.verdict === "string" ? `review:${metadata.verdict}` : null,
      typeof metadata.gateStatus === "string" ? `gates:${metadata.gateStatus}` : null,
      typeof metadata.reason === "string" ? metadata.reason : null,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    return values.join(" · ");
  }
}

export function renderOperatorSnapshotHtml(params: { cwd: string; runId: string; generatedAt: string }): string {
  const run = loadRunManifest(params.runId, params.cwd);
  const initiative = loadInitiative(params.runId, params.cwd);
  const taskGraph = loadTaskGraph(params.runId, params.cwd);
  const status = getRunStatusSummary(params.cwd, params.runId).latest[0];
  const timeline = buildRunActivityTimeline({
    cwd: params.cwd,
    runId: params.runId,
    now: new Date(params.generatedAt),
  });
  const attempts = new Set(
    timeline.activities
      .map((activity) => activity.attemptId)
      .filter((attemptId): attemptId is string => typeof attemptId === "string"),
  ).size;

  const artifactRows = status?.artifactPaths
    ? Object.entries(status.artifactPaths)
        .map(([label, ref]) => `<tr><td>${escapeHtml(label)}</td><td><code>${escapeHtml(ref)}</code></td></tr>`)
        .join("")
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>kiwi ${escapeHtml(params.runId)}</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; color: #172026; background: #f7f4ef; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 20px 44px; }
    header { display: grid; grid-template-columns: 1fr auto; gap: 20px; align-items: end; border-bottom: 1px solid #d7d1c6; padding-bottom: 18px; }
    h1 { margin: 0; font-size: 26px; line-height: 1.2; font-weight: 720; }
    h2 { margin: 28px 0 10px; font-size: 16px; }
    .meta { color: #5b6570; font-size: 13px; }
    .pill { display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border: 1px solid #a8b1a3; background: #eef3e8; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-top: 18px; }
    .metric { border: 1px solid #d7d1c6; background: #fffdf9; padding: 12px; }
    .metric strong { display: block; font-size: 22px; }
    .activity-timeline, .activity-children { list-style: none; margin: 0; padding: 0; }
    .activity-timeline { border: 1px solid #d7d1c6; background: #fffdf9; }
    .activity { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 8px; padding: 9px 10px; border-bottom: 1px solid #e7e1d8; }
    .activity:last-child { border-bottom: 0; }
    .activity-children { grid-column: 2; margin-top: 8px; border-left: 2px solid #d7d1c6; padding-left: 10px; }
    .activity-children .activity { padding: 6px 0 6px 8px; border-bottom: 0; }
    .activity-marker { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 720; }
    .activity-title { display: block; font-size: 13px; }
    .activity-meta { display: block; margin-top: 2px; color: #5b6570; font-size: 12px; }
    .activity-completed .activity-marker { color: #166534; }
    .activity-running .activity-marker { color: #0f5ea8; }
    .activity-pending .activity-marker, .activity-skipped .activity-marker { color: #69737d; }
    .activity-failed .activity-marker { color: #b42318; }
    .activity-blocked .activity-marker { color: #8a4b00; }
    table { width: 100%; border-collapse: collapse; background: #fffdf9; border: 1px solid #d7d1c6; }
    th, td { text-align: left; border-bottom: 1px solid #e7e1d8; padding: 9px 10px; font-size: 13px; vertical-align: top; }
    th { color: #45515c; background: #ece7dd; font-weight: 650; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    ul { margin: 0; padding-left: 18px; }
    @media (max-width: 760px) { header, .grid { grid-template-columns: 1fr; } table { display: block; overflow-x: auto; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>${escapeHtml(initiative.title)}</h1>
        <div class="meta">${escapeHtml(run.runId)} · plan ${escapeHtml(run.currentPlanId)} · generated ${escapeHtml(params.generatedAt)}</div>
      </div>
      <div class="pill">${escapeHtml(run.status)}</div>
    </header>
    <section class="grid">
      <div class="metric"><span>steps</span><strong>${taskGraph.steps.length}</strong></div>
      <div class="metric"><span>completed</span><strong>${timeline.summary.completed}</strong></div>
      <div class="metric"><span>active</span><strong>${timeline.summary.running}</strong></div>
      <div class="metric"><span>failed/blocked</span><strong>${timeline.summary.failed + timeline.summary.blocked}</strong></div>
      <div class="metric"><span>attempts</span><strong>${attempts}</strong></div>
      <div class="metric"><span>risk</span><strong>${taskGraph.riskScore}</strong></div>
      <div class="metric"><span>complexity</span><strong>${taskGraph.complexityScore}</strong></div>
    </section>
    <h2>Activity</h2>
    ${new OperatorSnapshotActivityRenderer(timeline.activities).render()}
    <h2>Acceptance</h2>
    <ul>${renderList(taskGraph.acceptanceCriteria)}</ul>
    <h2>Artifacts</h2>
    <table><thead><tr><th>Artifact</th><th>Path</th></tr></thead><tbody>${artifactRows}</tbody></table>
  </main>
</body>
</html>
`;
}

export function writeOperatorSnapshot(params: {
  cwd: string;
  runId: string;
  now?: Date | undefined;
}): OperatorSnapshotResult {
  ensureRunLayout(params.runId, params.cwd);
  const generatedAt = (params.now ?? new Date()).toISOString();
  const ref = "operator/index.html";
  const html = renderOperatorSnapshotHtml({
    cwd: params.cwd,
    runId: params.runId,
    generatedAt,
  });
  writeTextSafely(resolveRunArtifactPath(params.runId, ref, params.cwd), html);
  appendAuditEvent(params.cwd, {
    eventType: "operator_snapshot_written",
    runId: params.runId,
    timestamp: generatedAt,
    payload: { ref },
  });

  return {
    runId: params.runId,
    ref,
    generatedAt,
  };
}
