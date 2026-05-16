import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";

/**
 * Atomically write a JSON value to disk.
 *
 * The file is written to a sibling temp path first and then renamed onto
 * the target so concurrent readers never observe a half-written file.
 */
export function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

/**
 * Read a JSON file. Throws ENOENT if missing - callers that want a
 * friendlier error should use {@link readJsonOrThrow}.
 */
export function readJson(target: string): unknown {
  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}

/**
 * Read a JSON file or throw the supplied error if it does not exist.
 *
 * Callers that need a typed shape should validate the returned value with
 * a Zod schema; this helper is intentionally permissive about JSON shape.
 */
export function readJsonOrThrow(target: string, missingMessage: string): unknown {
  if (!existsSync(target)) {
    throw new Error(missingMessage);
  }

  return readJson(target);
}

/**
 * Append a JSON value as a single line (JSONL) to a file.
 */
export function appendJsonLine(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify(value)}\n`, "utf-8");
}
