import { mkdirSync, renameSync, writeFileSync } from "fs";
import path from "path";
import {
  appendAuditEvent,
  ensureRunLayout,
  getRunStatusSummary,
  listStepAttemptEvidence,
  loadInitiative,
  loadRunManifest,
  loadTaskGraph,
  resolveRunArtifactPath,
} from "@kiwi/core";

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

export function renderOperatorSnapshotHtml(params: { cwd: string; runId: string; generatedAt: string }): string {
  const run = loadRunManifest(params.runId, params.cwd);
  const initiative = loadInitiative(params.runId, params.cwd);
  const taskGraph = loadTaskGraph(params.runId, params.cwd);
  const status = getRunStatusSummary(params.cwd, params.runId).latest[0];
  const attempts = listStepAttemptEvidence(params.cwd, params.runId);

  const stepRows = taskGraph.steps
    .map((step) => {
      const latestAttempt = attempts.filter((attempt) => attempt.stepId === step.stepId).at(-1);
      const attemptStatus = latestAttempt?.attempt.status ?? "missing";
      const review = latestAttempt?.reviewVerdict?.verdict ?? "missing";

      return `<tr><td>${escapeHtml(step.stepId)}</td><td>${escapeHtml(step.type)}</td><td>${escapeHtml(step.title)}</td><td>${escapeHtml(step.dependsOn.join(", ") || "none")}</td><td>${escapeHtml(attemptStatus)}</td><td>${escapeHtml(review)}</td></tr>`;
    })
    .join("");

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
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
    .metric { border: 1px solid #d7d1c6; background: #fffdf9; padding: 12px; }
    .metric strong { display: block; font-size: 22px; }
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
      <div class="metric"><span>attempts</span><strong>${attempts.length}</strong></div>
      <div class="metric"><span>risk</span><strong>${taskGraph.riskScore}</strong></div>
      <div class="metric"><span>complexity</span><strong>${taskGraph.complexityScore}</strong></div>
    </section>
    <h2>Steps</h2>
    <table><thead><tr><th>Step</th><th>Type</th><th>Title</th><th>Depends On</th><th>Attempt</th><th>Review</th></tr></thead><tbody>${stepRows}</tbody></table>
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
