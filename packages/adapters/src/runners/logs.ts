import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { Artifact } from "@kiwi/contracts";
import type { SubprocessOutputChunk } from "./subprocess.js";

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

export interface StreamingRunnerLog {
  /** Absolute path to the live NDJSON stream file (one JSON object per line). */
  path: string;
  /** Relative artifact ref (for inclusion in RunnerExecutionOutput.liveLogPath). */
  ref: string;
  /** Append one output chunk to the stream file. Secrets are redacted inline. */
  append(chunk: SubprocessOutputChunk): void;
  /** No-op; stream file is left on disk for callers to tail. Call to signal end-of-stream. */
  close(): void;
}

/**
 * Opens a live streaming log file that is written incrementally as subprocess output arrives.
 * Each call to `append()` writes one NDJSON line: `{"stream":"stdout","text":"…","t":"ISO"}\n`.
 * The file can be tailed while the subprocess is still running.
 *
 * This is complementary to `persistRunnerLogs()`, which writes the final consolidated JSON
 * after process completion. Both can be used together.
 */
export function openStreamingRunnerLog(params: {
  workspacePath: string;
  runId: string;
  stepId: string;
  attemptId: string;
  runner: string;
  secretValues?: string[] | undefined;
}): StreamingRunnerLog {
  const ref = `steps/${params.stepId}/${params.attemptId}/artifacts/${params.runner}-runner-stream.jsonl`;
  const target = path.join(params.workspacePath, ".kiwi", "runs", params.runId, ref);
  mkdirSync(path.dirname(target), { recursive: true });
  const secrets = params.secretValues ?? [];

  return {
    path: target,
    ref,
    append(chunk: SubprocessOutputChunk): void {
      const safe = redactValue(chunk.text, secrets);
      const line = JSON.stringify({ stream: chunk.stream, text: safe, t: new Date().toISOString() }) + "\n";
      appendFileSync(target, line, "utf-8");
    },
    close(): void {
      // intentionally a no-op: file remains on disk for post-hoc tailing
    },
  };
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
