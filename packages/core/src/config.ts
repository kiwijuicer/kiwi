import { existsSync, readFileSync } from "fs";
import { load } from "js-yaml";
import {
  KiwiPolicy,
  KiwiPolicySchema,
  ModelRegistry,
  ModelRegistrySchema,
} from "@ai-kiwi/contracts";

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
