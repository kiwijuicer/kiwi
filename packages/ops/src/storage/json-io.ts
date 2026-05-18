import { mkdirSync, renameSync, writeFileSync } from "fs";
import path from "path";

// Local copy of the core helper.
// Kept in lockstep with packages/core/src/storage/json-io.ts.
// Local to avoid widening @kiwi/ops's runtime surface to a built dist
// during typecheck-before-build cycles.
export function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}
