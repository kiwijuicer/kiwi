import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import os from "os";
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

export interface KiwiConfigLoadOptions {
  env?: Record<string, string | undefined>;
}

type JsonObject = Record<string, unknown>;

class YamlFileStore {
  read(target: string): unknown {
    return load(readFileSync(target, "utf-8"));
  }

  writeSafely(target: string, value: unknown): void {
    mkdirSync(path.dirname(target), { recursive: true });
    const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tempPath, dump(value, { lineWidth: 120, noRefs: true }), "utf-8");
    renameSync(tempPath, target);
  }
}

const yamlFileStore = new YamlFileStore();

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function kiwiPolicyPath(cwd: string): string {
  return path.join(cwd, ".kiwi", "policy.yaml");
}

export function kiwiModelRegistryPath(cwd: string): string {
  return path.join(cwd, ".kiwi", "model-registry.yaml");
}

export function resolveKiwiHome(env: Record<string, string | undefined> = process.env): string {
  const configured = env.KIWI_HOME?.trim();

  return configured ? path.resolve(configured) : path.join(os.homedir(), ".kiwi");
}

export function kiwiHomePolicyPath(env?: Record<string, string | undefined>): string {
  return path.join(resolveKiwiHome(env), "defaults", "policy.yaml");
}

export function kiwiHomeModelRegistryPath(env?: Record<string, string | undefined>): string {
  return path.join(resolveKiwiHome(env), "defaults", "model-registry.yaml");
}

function readYaml(target: string): unknown {
  return yamlFileStore.read(target);
}

export function loadPolicy(path: string): KiwiPolicy {
  if (!existsSync(path)) {
    throw new Error(`Policy file not found: ${path}`);
  }

  return KiwiPolicySchema.parse(readYaml(path));
}

export function loadRegistry(path: string): ModelRegistry {
  if (!existsSync(path)) {
    throw new Error(`Model registry file not found: ${path}`);
  }

  return ModelRegistrySchema.parse(readYaml(path));
}

export function saveRegistry(path: string, registry: ModelRegistry): ModelRegistry {
  const parsed = ModelRegistrySchema.parse(registry);
  writeYamlSafely(path, parsed);

  return parsed;
}

export function loadRawYaml(path: string): unknown {
  if (!existsSync(path)) {
    throw new Error(`YAML file not found: ${path}`);
  }

  return readYaml(path);
}

function mergeObjects(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) {
    return override;
  }

  const merged: JsonObject = { ...base };

  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in merged ? mergeObjects(merged[key], value) : value;
  }

  return merged;
}

function modelId(model: unknown): string {
  if (isRecord(model) && typeof model.id === "string" && model.id.length > 0) {
    return model.id;
  }

  throw new Error("Model registry entries must define a non-empty id");
}

function mergeRegistry(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) {
    return override;
  }

  const baseModels = Array.isArray(base.models) ? base.models : [];
  const hasOverrideModels = Object.prototype.hasOwnProperty.call(override, "models");

  if (hasOverrideModels && override.models !== undefined && !Array.isArray(override.models)) {
    throw new Error("Model registry override models must be an array");
  }
  const overrideModels = Array.isArray(override.models) ? override.models : [];
  const merged = mergeObjects(base, { ...override, models: undefined });

  if (!isRecord(merged)) {
    return merged;
  }

  const modelsById = new Map<string, unknown>();
  const orderedIds: string[] = [];

  for (const model of baseModels) {
    const id = modelId(model);

    modelsById.set(id, model);
    orderedIds.push(id);
  }

  for (const model of overrideModels) {
    const id = modelId(model);

    const existing = modelsById.get(id);
    modelsById.set(id, existing ? mergeObjects(existing, model) : model);
    if (!orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  }

  merged.models = orderedIds.map((id) => modelsById.get(id));

  return merged;
}

export function loadEffectivePolicy(workspacePath: string, opts: KiwiConfigLoadOptions = {}): KiwiPolicy {
  const homePath = kiwiHomePolicyPath(opts.env);
  const workspacePathValue = kiwiPolicyPath(workspacePath);

  if (!existsSync(homePath)) {
    return loadPolicy(homePath);
  }

  const base = KiwiPolicySchema.parse(readYaml(homePath));
  const merged = existsSync(workspacePathValue) ? mergeObjects(base, readYaml(workspacePathValue)) : base;

  return KiwiPolicySchema.parse(merged);
}

export function loadEffectiveRegistry(workspacePath: string, opts: KiwiConfigLoadOptions = {}): ModelRegistry {
  const homePath = kiwiHomeModelRegistryPath(opts.env);
  const workspacePathValue = kiwiModelRegistryPath(workspacePath);

  if (!existsSync(homePath)) {
    return loadRegistry(homePath);
  }

  const base = ModelRegistrySchema.parse(readYaml(homePath));
  const merged = existsSync(workspacePathValue) ? mergeRegistry(base, readYaml(workspacePathValue)) : base;

  return ModelRegistrySchema.parse(merged);
}

function writeYamlSafely(target: string, value: unknown): void {
  yamlFileStore.writeSafely(target, value);
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
