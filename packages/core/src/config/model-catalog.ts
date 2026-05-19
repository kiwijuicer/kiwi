import { existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import {
  AccessModeSchema,
  AgentRoleSchema,
  ModelCapabilitySchema,
  ModelEntry,
  ModelPricing,
  ModelPricingSchema,
  ModelProviderSchema,
  ModelRegistry,
  ModelRegistrySchema,
} from "@kiwi/contracts";
import { appendJsonLine } from "../storage/json-io";
import {
  kiwiHomeModelRegistryPath,
  kiwiModelRegistryPath,
  loadRawYaml,
  loadRegistry,
  resolveKiwiHome,
  saveRegistry,
} from "./index";
import { AuditEventTypes } from "../ledger/cost-ledger";

export interface ModelCatalogProvider {
  name: string;
  sourceUrl: string;
}

export interface ModelCatalogEntry {
  id: string;
  providerModel?: string;
  provider: string;
  capability: string;
  roles: string[];
  accessMode: string;
  enabled: boolean;
  pricingRef: string;
  deprecatedAt?: string | null;
  replacementModelId?: string | null;
}

export interface ModelCatalog {
  catalogVersion: string;
  generatedAt: string;
  pricingLastVerifiedAt: string;
  providers: ModelCatalogProvider[];
  pricing: Record<string, ModelPricing>;
  tierMapping: Record<string, string[]>;
  models: ModelCatalogEntry[];
}

export interface ModelRegistryDiff {
  catalogVersion: string;
  addedModelIds: string[];
  removedModelIds: string[];
  providerModelChanges: Array<{ modelId: string; before: string | null; after: string | null }>;
  pricingChanges: string[];
  pricingVersionChanges: Array<{ modelId: string; before: string | null; after: string | null }>;
  disabledModelIds: string[];
  deprecatedModelIds: string[];
  workspaceOverrideConflicts: string[];
}

export interface ModelRegistryUpdateResult {
  applied: boolean;
  homeRegistryPath: string;
  workspaceRegistryPath: string | null;
  registry: ModelRegistry;
  diff: ModelRegistryDiff;
}

export interface ModelRegistryUpdateOptions {
  catalogPath: string;
  workspacePath?: string;
  apply?: boolean;
  env?: Record<string, string | undefined>;
  now?: Date;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCatalog(catalogPath: string): ModelCatalog {
  const raw = JSON.parse(readFileSync(catalogPath, "utf-8")) as unknown;

  if (!isRecord(raw)) {
    throw new Error(`Model catalog must be an object: ${catalogPath}`);
  }

  const catalog = raw as Partial<ModelCatalog>;

  if (!catalog.catalogVersion || !Array.isArray(catalog.models) || !isRecord(catalog.pricing)) {
    throw new Error(`Model catalog is missing catalogVersion, pricing, or models: ${catalogPath}`);
  }

  return {
    catalogVersion: String(catalog.catalogVersion),
    generatedAt: String(catalog.generatedAt ?? ""),
    pricingLastVerifiedAt: String(catalog.pricingLastVerifiedAt ?? ""),
    providers: Array.isArray(catalog.providers) ? catalog.providers : [],
    pricing: Object.fromEntries(
      Object.entries(catalog.pricing).map(([key, value]) => [key, ModelPricingSchema.parse(value)]),
    ),
    tierMapping: isRecord(catalog.tierMapping) ? (catalog.tierMapping as Record<string, string[]>) : {},
    models: catalog.models,
  };
}

function catalogEntryToModel(entry: ModelCatalogEntry, pricing: Record<string, ModelPricing>): ModelEntry {
  const modelPricing = pricing[entry.pricingRef];

  if (!modelPricing) {
    throw new Error(`Model '${entry.id}' references missing catalog pricing '${entry.pricingRef}'`);
  }

  return {
    id: entry.id,
    ...(entry.providerModel ? { providerModel: entry.providerModel } : {}),
    provider: ModelProviderSchema.parse(entry.provider),
    capability: ModelCapabilitySchema.parse(entry.capability),
    roles: entry.roles.map((role) => AgentRoleSchema.parse(role)),
    pricing: modelPricing,
    enabled: entry.deprecatedAt ? false : entry.enabled,
    accessMode: AccessModeSchema.parse(entry.accessMode),
    ...(entry.deprecatedAt !== undefined ? { deprecatedAt: entry.deprecatedAt } : {}),
    ...(entry.replacementModelId !== undefined ? { replacementModelId: entry.replacementModelId } : {}),
  };
}

function registryFromCatalog(catalog: ModelCatalog): ModelRegistry {
  return ModelRegistrySchema.parse({
    version: "1",
    catalogVersion: catalog.catalogVersion,
    models: catalog.models.map((entry) => catalogEntryToModel(entry, catalog.pricing)),
  });
}

function modelsById(models: ModelEntry[]): Map<string, ModelEntry> {
  return new Map(models.map((model) => [model.id, model]));
}

function pricingChanged(before: ModelPricing, after: ModelPricing): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function workspaceOverrideIds(workspacePath: string | undefined): string[] {
  if (!workspacePath) {
    return [];
  }

  const registryPath = kiwiModelRegistryPath(workspacePath);

  if (!existsSync(registryPath)) {
    return [];
  }

  const raw = loadRawYaml(registryPath);

  if (!isRecord(raw) || !Array.isArray(raw.models)) {
    return [];
  }

  return raw.models
    .map((model) => (isRecord(model) ? optionalString(model.id) : null))
    .filter((id): id is string => id !== null);
}

function diffRegistries(params: {
  catalogVersion: string;
  before: ModelRegistry | null;
  after: ModelRegistry;
  workspaceOverrideIds: string[];
}): ModelRegistryDiff {
  const beforeById = modelsById(params.before?.models ?? []);
  const afterById = modelsById(params.after.models);
  const beforeIds = new Set(beforeById.keys());
  const afterIds = new Set(afterById.keys());
  const addedModelIds = [...afterIds].filter((id) => !beforeIds.has(id)).sort();
  const removedModelIds = [...beforeIds].filter((id) => !afterIds.has(id)).sort();
  const providerModelChanges: ModelRegistryDiff["providerModelChanges"] = [];
  const pricingChanges: string[] = [];
  const pricingVersionChanges: ModelRegistryDiff["pricingVersionChanges"] = [];
  const disabledModelIds: string[] = [];
  const deprecatedModelIds: string[] = [];

  for (const [id, after] of afterById) {
    const before = beforeById.get(id);

    if (before && (before.providerModel ?? null) !== (after.providerModel ?? null)) {
      providerModelChanges.push({
        modelId: id,
        before: before.providerModel ?? null,
        after: after.providerModel ?? null,
      });
    }
    if (before && pricingChanged(before.pricing, after.pricing)) {
      pricingChanges.push(id);
      pricingVersionChanges.push({
        modelId: id,
        before: before.pricing.sourceVersion ?? null,
        after: after.pricing.sourceVersion ?? null,
      });
    }
    if (after.enabled === false && before?.enabled !== false) {
      disabledModelIds.push(id);
    }
    if (after.deprecatedAt) {
      deprecatedModelIds.push(id);
    }
  }

  return {
    catalogVersion: params.catalogVersion,
    addedModelIds,
    removedModelIds,
    providerModelChanges,
    pricingChanges: pricingChanges.sort(),
    pricingVersionChanges: pricingVersionChanges.sort((a, b) => a.modelId.localeCompare(b.modelId)),
    disabledModelIds: disabledModelIds.sort(),
    deprecatedModelIds: deprecatedModelIds.sort(),
    workspaceOverrideConflicts: params.workspaceOverrideIds.filter((id) => afterIds.has(id)).sort(),
  };
}

function readExistingRegistry(pathValue: string): ModelRegistry | null {
  return existsSync(pathValue) ? loadRegistry(pathValue) : null;
}

function appendRegistryRefreshAudit(params: {
  env: Record<string, string | undefined>;
  now: Date;
  diff: ModelRegistryDiff;
  homeRegistryPath: string;
}): void {
  const kiwiHome = resolveKiwiHome(params.env);
  const auditPath = path.join(kiwiHome, "logs", "audit.log");

  mkdirSync(path.dirname(auditPath), { recursive: true });
  appendJsonLine(auditPath, {
    eventType: AuditEventTypes.ModelRegistryRefreshed,
    runId: "model_registry",
    timestamp: params.now.toISOString(),
    payload: {
      catalogVersion: params.diff.catalogVersion,
      homeRegistryPath: params.homeRegistryPath,
      addedModelIds: params.diff.addedModelIds,
      removedModelIds: params.diff.removedModelIds,
      providerModelChanges: params.diff.providerModelChanges,
      pricingChanges: params.diff.pricingChanges,
      pricingVersionChanges: params.diff.pricingVersionChanges,
      disabledModelIds: params.diff.disabledModelIds,
      deprecatedModelIds: params.diff.deprecatedModelIds,
    },
  });
}

export class ModelRegistryUpdateService {
  update(options: ModelRegistryUpdateOptions): ModelRegistryUpdateResult {
    const env = options.env ?? process.env;
    const catalog = readCatalog(options.catalogPath);
    const nextRegistry = registryFromCatalog(catalog);
    const homeRegistryPath = kiwiHomeModelRegistryPath(env);
    const previous = readExistingRegistry(homeRegistryPath);
    const workspaceRegistryPath = options.workspacePath ? kiwiModelRegistryPath(options.workspacePath) : null;
    const diff = diffRegistries({
      catalogVersion: catalog.catalogVersion,
      before: previous,
      after: nextRegistry,
      workspaceOverrideIds: workspaceOverrideIds(options.workspacePath),
    });

    if (options.apply) {
      saveRegistry(homeRegistryPath, nextRegistry);
      appendRegistryRefreshAudit({
        env,
        now: options.now ?? new Date(),
        diff,
        homeRegistryPath,
      });
    }

    return {
      applied: options.apply === true,
      homeRegistryPath,
      workspaceRegistryPath,
      registry: nextRegistry,
      diff,
    };
  }
}
