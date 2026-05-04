import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "fs";
import path from "path";
import { EvidenceManifest, EvidenceManifestSchema, RunAuditSnapshot, RunAuditSnapshotSchema } from "@kiwi/contracts";
import { appendAuditEvent, readAuditEvents } from "./cost-ledger";
import { ensureRunLayout, resolveRunArtifactPath } from "./run-store";

export interface EvidenceManifestResult {
  manifest: EvidenceManifest;
  manifestRef: string;
  auditSnapshot: RunAuditSnapshot;
  auditSnapshotRef: string;
}

function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

function runRoot(cwd: string, runId: string): string {
  return resolveRunArtifactPath(runId, ".", cwd);
}

function normalizeRef(root: string, target: string): string {
  return path.relative(root, target).replaceAll(path.sep, "/");
}

function shouldSkip(ref: string): boolean {
  return ref === "run.lock" || ref === "final/evidence-manifest.json" || ref.startsWith("worktrees/");
}

function listRunFiles(root: string, current: string = root): string[] {
  if (!existsSync(current)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    const ref = normalizeRef(root, target);
    if (shouldSkip(ref)) continue;
    if (entry.isDirectory()) {
      files.push(...listRunFiles(root, target));
      continue;
    }
    if (entry.isFile()) files.push(target);
  }
  return files.sort((a, b) => normalizeRef(root, a).localeCompare(normalizeRef(root, b)));
}

function fileHash(root: string, target: string): EvidenceManifest["files"][number] {
  const bytes = readFileSync(target);
  return {
    ref: normalizeRef(root, target),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: statSync(target).size,
  };
}

export function writeRunAuditSnapshot(params: { cwd: string; runId: string; now?: Date | undefined }): {
  snapshot: RunAuditSnapshot;
  ref: string;
} {
  ensureRunLayout(params.runId, params.cwd);
  const createdAt = (params.now ?? new Date()).toISOString();
  const events = readAuditEvents(params.cwd, params.runId);
  const snapshot = RunAuditSnapshotSchema.parse({
    schemaVersion: "1",
    runId: params.runId,
    eventCount: events.length,
    events,
    createdAt,
  });
  const ref = "final/audit-events.json";
  writeJsonSafely(resolveRunArtifactPath(params.runId, ref, params.cwd), snapshot);
  appendAuditEvent(params.cwd, {
    eventType: "run_audit_snapshot_written",
    runId: params.runId,
    timestamp: createdAt,
    payload: {
      ref,
      eventCount: events.length,
    },
  });
  return { snapshot, ref };
}

export function writeEvidenceManifest(params: {
  cwd: string;
  runId: string;
  now?: Date | undefined;
}): EvidenceManifestResult {
  ensureRunLayout(params.runId, params.cwd);
  const generatedAt = (params.now ?? new Date()).toISOString();
  const audit = writeRunAuditSnapshot({
    cwd: params.cwd,
    runId: params.runId,
    now: params.now,
  });
  const root = runRoot(params.cwd, params.runId);
  const files = listRunFiles(root).map((target) => fileHash(root, target));
  const manifest = EvidenceManifestSchema.parse({
    schemaVersion: "1",
    runId: params.runId,
    generatedAt,
    auditSnapshotRef: audit.ref,
    files,
  });
  const manifestRef = "final/evidence-manifest.json";
  writeJsonSafely(resolveRunArtifactPath(params.runId, manifestRef, params.cwd), manifest);
  appendAuditEvent(params.cwd, {
    eventType: "evidence_manifest_written",
    runId: params.runId,
    timestamp: generatedAt,
    payload: {
      manifestRef,
      auditSnapshotRef: audit.ref,
      fileCount: files.length,
    },
  });
  return {
    manifest,
    manifestRef,
    auditSnapshot: audit.snapshot,
    auditSnapshotRef: audit.ref,
  };
}

export function loadEvidenceManifest(params: { cwd: string; runId: string }): EvidenceManifest {
  const target = resolveRunArtifactPath(params.runId, "final/evidence-manifest.json", params.cwd);
  return EvidenceManifestSchema.parse(JSON.parse(readFileSync(target, "utf-8")) as unknown);
}
