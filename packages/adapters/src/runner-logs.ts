import { mkdirSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { Artifact } from "@kiwi/contracts";

// Local copy of writeJsonSafely. Adapters is a low-level package
// without a runtime dependency on @kiwi/core, so the same atomic
// JSON write is duplicated here. Keep this in lockstep with
// packages/core/src/storage/json-io.ts.
function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

function redactValue(value: string, secrets: string[]): string {
  return secrets
    .filter((secret) => secret.length >= 4)
    .reduce((current, secret) => current.split(secret).join("[REDACTED]"), value)
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]");
}

export function persistRunnerLogs(params: {
  workspacePath: string;
  runId: string;
  stepId: string;
  attemptId: string;
  runner: string;
  payload: {
    binary: string;
    args: string[];
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
    startedAt: string;
    completedAt: string;
  };
  secretValues?: string[] | undefined;
}): Artifact {
  const ref = `steps/${params.stepId}/${params.attemptId}/artifacts/${params.runner}-runner-logs.json`;
  const target = path.join(params.workspacePath, ".kiwi", "runs", params.runId, ref);
  const secrets = params.secretValues ?? [];
  writeJsonSafely(target, {
    ...params.payload,
    stdout: redactValue(params.payload.stdout, secrets),
    stderr: redactValue(params.payload.stderr, secrets),
  });
  return {
    type: "command_output",
    ref,
    createdAt: params.payload.completedAt,
  };
}
