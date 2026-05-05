import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";

export function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

export function readJson(target: string): unknown {
  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}
