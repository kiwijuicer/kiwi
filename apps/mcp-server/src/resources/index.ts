import { Dirent, existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import {
  getRunStatusSummary,
  isValidRunId,
  listRunIds,
  listStepAttemptEvidence,
  loadInitiative,
  loadRunManifest,
  loadTaskGraph,
  readAuditEvents,
  readModelInvocations,
  resolveRunArtifactPath,
  summarizeModelInvocations,
} from "@kiwi/core";
import {
  buildRunActivityTimeline,
  buildWorkspaceActivityTimeline,
  loadEvidenceManifest,
  renderActivityTimelineMarkdown,
  renderWorkspaceActivityTimelineMarkdown,
} from "@kiwi/ops";

interface McpResourceContent {
  uri: string;
  text: string;
  mimeType?: string;
}

interface McpResource {
  uri: string;
  name: string;
  mimeType?: string;
}

interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  mimeType?: string;
}

export class McpResourceNotFoundError extends Error {
  readonly code = -32002 as const;
  readonly data: {
    category: "resource_not_found";
    uri?: string;
    ref?: string;
  };

  constructor(message: string, data: { uri?: string; ref?: string } = {}) {
    super(message);
    this.name = "McpResourceNotFoundError";
    this.data = { category: "resource_not_found", ...data };
  }
}

const MIME_JSON = "application/json";
const MIME_MARKDOWN = "text/markdown";
const MIME_HTML = "text/html";

const MCP_RESOURCE_TEMPLATES = [
  { uriTemplate: "kiwi://workspace/activity-timeline", name: "Workspace Activity Timeline", mimeType: MIME_JSON },
  {
    uriTemplate: "kiwi://workspace/activity-timeline.md",
    name: "Workspace Activity Timeline Markdown",
    mimeType: MIME_MARKDOWN,
  },
  { uriTemplate: "kiwi://runs/{runId}", name: "Run Status", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/manifest", name: "Run Manifest", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/initiative", name: "Initiative", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/task-graph", name: "TaskGraph", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/planner-input", name: "Planner Input", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/planner-output", name: "Planner Output", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/planner-cost", name: "Planner Cost", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/model-invocations", name: "Model Invocations", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/model-usage-summary", name: "Model Usage Summary", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/activity-timeline", name: "Activity Timeline", mimeType: MIME_JSON },
  {
    uriTemplate: "kiwi://runs/{runId}/activity-timeline.md",
    name: "Activity Timeline Markdown",
    mimeType: MIME_MARKDOWN,
  },
  {
    uriTemplate: "kiwi://runs/{runId}/previews/{previewToken}",
    name: "MCP Preview Token",
    mimeType: MIME_JSON,
  },
  { uriTemplate: "kiwi://runs/{runId}/attempts", name: "Step Attempts", mimeType: MIME_JSON },
  {
    uriTemplate: "kiwi://runs/{runId}/attempts/{stepId}/{attemptId}",
    name: "StepAttempt",
    mimeType: MIME_JSON,
  },
  {
    uriTemplate: "kiwi://runs/{runId}/attempts/{stepId}/{attemptId}/gate-results",
    name: "Gate Results",
    mimeType: MIME_JSON,
  },
  {
    uriTemplate: "kiwi://runs/{runId}/attempts/{stepId}/{attemptId}/review-verdict",
    name: "Review Verdict",
    mimeType: MIME_JSON,
  },
  {
    uriTemplate: "kiwi://runs/{runId}/attempts/{stepId}/{attemptId}/attempt-summary",
    name: "Attempt Summary",
    mimeType: MIME_JSON,
  },
  { uriTemplate: "kiwi://runs/{runId}/final-verdict", name: "Final Verdict", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/final-cost-report", name: "Final Cost Report", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/final-summary", name: "Final Summary", mimeType: MIME_MARKDOWN },
  { uriTemplate: "kiwi://runs/{runId}/pr-draft", name: "PR Draft", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/audit", name: "Audit Events", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/audit-snapshot", name: "Audit Snapshot", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/evidence-manifest", name: "Evidence Manifest", mimeType: MIME_JSON },
  { uriTemplate: "kiwi://runs/{runId}/operator-snapshot", name: "Operator Snapshot", mimeType: MIME_HTML },
  { uriTemplate: "kiwi://runs/{runId}/artifacts/{artifactRef}", name: "Artifact" },
];

function mimeTypeForRef(ref: string): string {
  if (ref.endsWith(".json")) {
    return MIME_JSON;
  }
  if (ref.endsWith(".md") || ref.endsWith(".markdown")) {
    return MIME_MARKDOWN;
  }
  if (ref.endsWith(".patch") || ref.endsWith(".diff")) {
    return "text/x-diff";
  }
  if (ref.endsWith(".html")) {
    return MIME_HTML;
  }

  return "text/plain";
}

function collectFiles(params: {
  cwd: string;
  runId: string;
  relativeDir: string;
}): Array<{ ref: string; name: string }> {
  const root = resolveRunArtifactPath(params.runId, params.relativeDir, params.cwd);

  if (!existsSync(root)) {
    return [];
  }
  const files: Array<{ ref: string; name: string }> = [];
  function walk(absDir: string, relDir: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true }) as Dirent[]) {
      const ref = path.posix.join(relDir, entry.name);
      const abs = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        walk(abs, ref);
        continue;
      }
      if (entry.isFile()) {
        files.push({ ref, name: ref });
      }
    }
  }
  walk(root, params.relativeDir);

  return files;
}

export function listResourceTemplates(): McpResourceTemplate[] {
  return MCP_RESOURCE_TEMPLATES;
}

export function listResources(cwd: string): McpResource[] {
  const runs = listRunIds(cwd).filter(isValidRunId);
  const concreteRuns: McpResource[] = [
    { uri: "kiwi://runs", name: "Runs", mimeType: MIME_JSON },
    { uri: "kiwi://workspace/activity-timeline", name: "Workspace Activity Timeline", mimeType: MIME_JSON },
    {
      uri: "kiwi://workspace/activity-timeline.md",
      name: "Workspace Activity Timeline Markdown",
      mimeType: MIME_MARKDOWN,
    },
    ...runs.map((runId) => ({
      uri: `kiwi://runs/${runId}`,
      name: `${runId} Status`,
      mimeType: MIME_JSON,
    })),
    ...runs.flatMap((runId) => [
      {
        uri: `kiwi://runs/${runId}/activity-timeline`,
        name: `${runId} Activity Timeline`,
        mimeType: MIME_JSON,
      },
      {
        uri: `kiwi://runs/${runId}/activity-timeline.md`,
        name: `${runId} Activity Timeline Markdown`,
        mimeType: MIME_MARKDOWN,
      },
    ]),
  ];
  const dynamic = runs.flatMap((runId) =>
    ["plan", "previews", "steps", "final"].flatMap((relativeDir) =>
      collectFiles({ cwd, runId, relativeDir }).map((file) => ({
        uri: `kiwi://runs/${runId}/artifacts/${encodeURIComponent(file.ref)}`,
        name: `${runId}/${file.name}`,
        mimeType: mimeTypeForRef(file.ref),
      })),
    ),
  );

  return [...concreteRuns, ...dynamic];
}

function assertReadableRunId(runId: string, uri: string): void {
  if (!isValidRunId(runId)) {
    throw new McpResourceNotFoundError(`Unsupported resource URI: ${uri}`, { uri });
  }
}

function readJsonRunArtifact(runId: string, ref: string, cwd: string): unknown {
  const target = resolveRunArtifactPath(runId, ref, cwd);

  if (!existsSync(target)) {
    throw new McpResourceNotFoundError(`Artifact not found: ${ref}`, { ref });
  }

  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}

function readTextRunArtifact(runId: string, ref: string, cwd: string): string {
  const target = resolveRunArtifactPath(runId, ref, cwd);

  if (!existsSync(target)) {
    throw new McpResourceNotFoundError(`Artifact not found: ${ref}`, { ref });
  }

  return readFileSync(target, "utf-8");
}

function asContent(uri: string, value: unknown, mimeType?: string): McpResourceContent {
  const content: McpResourceContent = {
    uri,
    text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
  };

  if (mimeType) {
    content.mimeType = mimeType;
  }

  return content;
}

const RUN_JSON_RESOURCE_REFS: Record<string, string> = {
  "planner-input": "plan/planner-input.json",
  "planner-output": "plan/planner-output.json",
  "planner-cost": "plan/cost-report.json",
  "final-verdict": "final/final-verdict.json",
  "final-cost-report": "final/final-cost-report.json",
  "pr-draft": "final/pr-draft.json",
  "audit-snapshot": "final/audit-events.json",
};

const RUN_TEXT_RESOURCE_REFS: Record<string, { ref: string; mimeType: string }> = {
  "final-summary": { ref: "final/final-summary.md", mimeType: MIME_MARKDOWN },
  "operator-snapshot": { ref: "operator/index.html", mimeType: MIME_HTML },
};

function readNamedRunResource(uri: string, runId: string, tail: string, cwd: string): McpResourceContent | null {
  if (!tail) {
    return asContent(uri, getRunStatusSummary(cwd, runId), MIME_JSON);
  }
  if (tail === "manifest") {
    return asContent(uri, loadRunManifest(runId, cwd), MIME_JSON);
  }
  if (tail === "initiative") {
    return asContent(uri, loadInitiative(runId, cwd), MIME_JSON);
  }
  if (tail === "task-graph") {
    return asContent(uri, loadTaskGraph(runId, cwd), MIME_JSON);
  }
  if (tail === "model-invocations") {
    return asContent(uri, readModelInvocations(cwd, runId), MIME_JSON);
  }
  if (tail === "model-usage-summary") {
    return asContent(uri, summarizeModelInvocations({ cwd, runId }), MIME_JSON);
  }
  if (tail === "activity-timeline") {
    return asContent(uri, buildRunActivityTimeline({ cwd, runId }), MIME_JSON);
  }
  if (tail === "activity-timeline.md") {
    return asContent(uri, renderActivityTimelineMarkdown(buildRunActivityTimeline({ cwd, runId })), MIME_MARKDOWN);
  }
  if (tail === "attempts") {
    return asContent(uri, listStepAttemptEvidence(cwd, runId), MIME_JSON);
  }
  if (tail === "audit") {
    return asContent(uri, readAuditEvents(cwd, runId), MIME_JSON);
  }
  if (tail === "evidence-manifest") {
    return asContent(uri, loadEvidenceManifest({ cwd, runId }), MIME_JSON);
  }

  const jsonRef = RUN_JSON_RESOURCE_REFS[tail];

  if (jsonRef) {
    return asContent(uri, readJsonRunArtifact(runId, jsonRef, cwd), MIME_JSON);
  }
  const textRef = RUN_TEXT_RESOURCE_REFS[tail];

  if (textRef) {
    return asContent(uri, readTextRunArtifact(runId, textRef.ref, cwd), textRef.mimeType);
  }

  return null;
}

function readAttemptResource(uri: string, runId: string, tail: string, cwd: string): McpResourceContent | null {
  const attemptMatch = tail.match(/^attempts\/([^/]+)\/([^/]+)(?:\/(.+))?$/);

  if (!attemptMatch?.[1] || !attemptMatch[2]) {
    return null;
  }
  const stepId = attemptMatch[1];
  const attemptId = attemptMatch[2];
  const section = attemptMatch[3] ?? "";
  const refs: Record<string, string> = {
    "": `steps/${stepId}/${attemptId}/attempt.json`,
    "gate-results": `steps/${stepId}/${attemptId}/gate-results.json`,
    "review-verdict": `steps/${stepId}/${attemptId}/artifacts/review-report.json`,
    "attempt-summary": `steps/${stepId}/${attemptId}/artifacts/attempt-summary.json`,
  };
  const ref = refs[section];

  return ref ? asContent(uri, readJsonRunArtifact(runId, ref, cwd), MIME_JSON) : null;
}

function readResource(uri: string, cwd: string): McpResourceContent {
  if (uri === "kiwi://runs") {
    return asContent(uri, getRunStatusSummary(cwd), MIME_JSON);
  }
  if (uri === "kiwi://workspace/activity-timeline") {
    return asContent(uri, buildWorkspaceActivityTimeline({ cwd }), MIME_JSON);
  }
  if (uri === "kiwi://workspace/activity-timeline.md") {
    return asContent(
      uri,
      renderWorkspaceActivityTimelineMarkdown(buildWorkspaceActivityTimeline({ cwd })),
      MIME_MARKDOWN,
    );
  }
  const runMatch = uri.match(/^kiwi:\/\/runs\/([^/]+)(?:\/(.+))?$/);
  const runId = runMatch?.[1];
  const tail = runMatch?.[2] ?? "";

  if (!runId) {
    throw new McpResourceNotFoundError(`Unsupported resource URI: ${uri}`, { uri });
  }
  assertReadableRunId(runId, uri);

  const named = readNamedRunResource(uri, runId, tail, cwd);

  if (named) {
    return named;
  }
  const attempt = readAttemptResource(uri, runId, tail, cwd);

  if (attempt) {
    return attempt;
  }

  const previewMatch = tail.match(/^previews\/([^/]+)$/);

  if (previewMatch?.[1]) {
    return asContent(
      uri,
      readJsonRunArtifact(runId, `previews/${decodeURIComponent(previewMatch[1])}.json`, cwd),
      MIME_JSON,
    );
  }

  const artifactMatch = tail.match(/^artifacts\/(.+)$/);

  if (artifactMatch?.[1]) {
    const ref = decodeURIComponent(artifactMatch[1]);

    return asContent(uri, readTextRunArtifact(runId, ref, cwd), mimeTypeForRef(ref));
  }

  throw new McpResourceNotFoundError(`Unsupported resource URI: ${uri}`, { uri });
}

export function readMcpResource(uri: string, cwd: string): McpResourceContent {
  return readResource(uri, cwd);
}
