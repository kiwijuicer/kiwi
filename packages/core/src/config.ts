import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { dump, load } from "js-yaml";
import {
  KiwiConfig,
  KiwiConfigSchema,
  KiwiPolicy,
  KiwiPolicySchema,
  ModelRegistry,
  ModelRegistrySchema,
} from "@kiwi/contracts";

export function loadPolicy(path: string): KiwiPolicy {
  if (!existsSync(path)) {
    throw new Error(`Policy file not found: ${path}`);
  }

  const raw = readFileSync(path, "utf-8");
  const parsed: unknown = load(raw);
  return KiwiPolicySchema.parse(parsed);
}

export function loadRegistry(path: string): ModelRegistry {
  if (!existsSync(path)) {
    throw new Error(`Model registry file not found: ${path}`);
  }

  const raw = readFileSync(path, "utf-8");
  const parsed: unknown = load(raw);
  return ModelRegistrySchema.parse(parsed);
}

function writeYamlSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, dump(value, { lineWidth: 120, noRefs: true }), "utf-8");
  renameSync(tempPath, target);
}

export function loadKiwiConfig(configPath: string): KiwiConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed: unknown = load(raw);
  return KiwiConfigSchema.parse(parsed);
}

export function saveKiwiConfig(configPath: string, config: KiwiConfig): KiwiConfig {
  const parsed = KiwiConfigSchema.parse(config);
  writeYamlSafely(configPath, parsed);
  return parsed;
}
