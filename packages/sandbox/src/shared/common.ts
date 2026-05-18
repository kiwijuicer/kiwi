import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "fs";
import path from "path";

function runsRoot(cwd: string): string {
  return path.join(cwd, ".kiwi", "runs");
}

function runDir(cwd: string, runId: string): string {
  return path.join(runsRoot(cwd), runId);
}

function auditLogPath(cwd: string): string {
  return path.join(cwd, ".kiwi", "logs", "audit.log");
}

export function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

export function appendAuditEvent(cwd: string, event: Record<string, unknown>): void {
  const target = auditLogPath(cwd);
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify(event)}\n`, "utf-8");
}

export function resolveRunArtifactPath(cwd: string, runId: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error("artifact path must be relative to run directory");
  }

  const base = path.resolve(runDir(cwd, runId));
  const target = path.resolve(base, relativePath);

  if (!(target === base || target.startsWith(`${base}${path.sep}`))) {
    throw new Error(`artifact path escapes run directory: ${relativePath}`);
  }

  return target;
}
