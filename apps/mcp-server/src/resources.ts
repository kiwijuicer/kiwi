import { Dirent, existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import {
  getRunStatusSummary,
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
import { loadEvidenceManifest } from "@kiwi/ops";

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

const MCP_RESOURCE_TEMPLATES = [
  { uriTemplate: "kiwi://runs/{runId}", name: "Run Status", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/manifest", name: "Run Manifest", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/initiative", name: "Initiative", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/task-graph", name: "TaskGraph", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/planner-input", name: "Planner Input", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/planner-output", name: "Planner Output", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/planner-cost", name: "Planner Cost", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/model-invocations", name: "Model Invocations", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/model-usage-summary", name: "Model Usage Summary", mimeType: "application/json" },
  {
    uriTemplate: "kiwi://runs/{runId}/previews/{previewToken}",
    name: "MCP Preview Token",
    mimeType: "application/json",
  },
  { uriTemplate: "kiwi://runs/{runId}/attempts", name: "Step Attempts", mimeType: "application/json" },
  {
    uriTemplate: "kiwi://runs/{runId}/attempts/{stepId}/{attemptId}",
    name: "StepAttempt",
    mimeType: "application/json",
  },
  {
    uriTemplate: "kiwi://runs/{runId}/attempts/{stepId}/{attemptId}/gate-results",
    name: "Gate Results",
    mimeType: "application/json",
  },
  {
    uriTemplate: "kiwi://runs/{runId}/attempts/{stepId}/{attemptId}/review-verdict",
    name: "Review Verdict",
    mimeType: "application/json",
  },
  {
    uriTemplate: "kiwi://runs/{runId}/attempts/{stepId}/{attemptId}/attempt-summary",
    name: "Attempt Summary",
    mimeType: "application/json",
  },
  { uriTemplate: "kiwi://runs/{runId}/final-verdict", name: "Final Verdict", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/final-cost-report", name: "Final Cost Report", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/final-summary", name: "Final Summary", mimeType: "text/markdown" },
  { uriTemplate: "kiwi://runs/{runId}/pr-draft", name: "PR Draft", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/audit", name: "Audit Events", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/audit-snapshot", name: "Audit Snapshot", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/evidence-manifest", name: "Evidence Manifest", mimeType: "application/json" },
  { uriTemplate: "kiwi://runs/{runId}/operator-snapshot", name: "Operator Snapshot", mimeType: "text/html" },
  { uriTemplate: "kiwi://runs/{runId}/artifacts/{artifactRef}", name: "Artifact" },
];

function mimeTypeForRef(ref: string): string {
  if (ref.endsWith(".json")) {
    return "application/json";
  }
  if (ref.endsWith(".md") || ref.endsWith(".markdown")) {
    return "text/markdown";
  }
  if (ref.endsWith(".patch") || ref.endsWith(".diff")) {
    return "text/x-diff";
  }
  if (ref.endsWith(".html")) {
    return "text/html";
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
  const runs = listRunIds(cwd);
  const concreteRuns: McpResource[] = [
    { uri: "kiwi://runs", name: "Runs", mimeType: "application/json" },
    ...runs.map((runId) => ({
      uri: `kiwi://runs/${runId}`,
      name: `${runId} Status`,
      mimeType: "application/json",
    })),
  ];
  const dynamic = listRunIds(cwd).flatMap((runId) =>
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

function readJsonRunArtifact(runId: string, ref: string, cwd: string): unknown {
  const target = resolveRunArtifactPath(runId, ref, cwd);

  if (!existsSync(target)) {
    throw new Error(`Artifact not found: ${ref}`);
  }

  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}

function readTextRunArtifact(runId: string, ref: string, cwd: string): string {
  const target = resolveRunArtifactPath(runId, ref, cwd);

  if (!existsSync(target)) {
    throw new Error(`Artifact not found: ${ref}`);
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
  "final-summary": { ref: "final/final-summary.md", mimeType: "text/markdown" },
  "operator-snapshot": { ref: "operator/index.html", mimeType: "text/html" },
};

function readNamedRunResource(uri: string, runId: string, tail: string, cwd: string): McpResourceContent | null {
  if (!tail) {
    return asContent(uri, getRunStatusSummary(cwd, runId), "application/json");
  }
  if (tail === "manifest") {
    return asContent(uri, loadRunManifest(runId, cwd), "application/json");
  }
  if (tail === "initiative") {
    return asContent(uri, loadInitiative(runId, cwd), "application/json");
  }
  if (tail === "task-graph") {
    return asContent(uri, loadTaskGraph(runId, cwd), "application/json");
  }
  if (tail === "model-invocations") {
    return asContent(uri, readModelInvocations(cwd, runId), "application/json");
  }
  if (tail === "model-usage-summary") {
    return asContent(uri, summarizeModelInvocations({ cwd, runId }), "application/json");
  }
  if (tail === "attempts") {
    return asContent(uri, listStepAttemptEvidence(cwd, runId), "application/json");
  }
  if (tail === "audit") {
    return asContent(uri, readAuditEvents(cwd, runId), "application/json");
  }
  if (tail === "evidence-manifest") {
    return asContent(uri, loadEvidenceManifest({ cwd, runId }), "application/json");
  }

  const jsonRef = RUN_JSON_RESOURCE_REFS[tail];

  if (jsonRef) {
    return asContent(uri, readJsonRunArtifact(runId, jsonRef, cwd), "application/json");
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

  return ref ? asContent(uri, readJsonRunArtifact(runId, ref, cwd), "application/json") : null;
}

function readResource(uri: string, cwd: string): McpResourceContent {
  if (uri === "kiwi://runs") {
    return asContent(uri, getRunStatusSummary(cwd), "application/json");
  }
  const runMatch = uri.match(/^kiwi:\/\/runs\/([^/]+)(?:\/(.+))?$/);
  const runId = runMatch?.[1];
  const tail = runMatch?.[2] ?? "";

  if (!runId) {
    throw new Error(`Unsupported resource URI: ${uri}`);
  }

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
      "application/json",
    );
  }

  const artifactMatch = tail.match(/^artifacts\/(.+)$/);

  if (artifactMatch?.[1]) {
    const ref = decodeURIComponent(artifactMatch[1]);

    return asContent(uri, readTextRunArtifact(runId, ref, cwd), mimeTypeForRef(ref));
  }

  throw new Error(`Unsupported resource URI: ${uri}`);
}

export function readMcpResource(uri: string, cwd: string): McpResourceContent {
  return readResource(uri, cwd);
}
