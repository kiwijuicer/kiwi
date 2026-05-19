import { z } from "zod";
import {
  ACCESS_MODE_VALUES,
  AccessModes,
  AgentRoleSchema,
  ApprovalStateSchema,
  BudgetProfileSchema,
  CODEX_SANDBOX_VALUES,
  CodexSandboxes,
  EXECUTION_ISOLATION_VALUES,
  EXECUTION_OWNER_VALUES,
  ExecutionIsolations,
  ExecutionOwners,
  IsoDateTimeSchema,
  MODEL_PROVIDER_VALUES,
  ModelProviders,
  ModelCapabilitySchema,
  NetworkPolicySchema,
  UsagePrecisionSchema,
  enumFrom,
} from "../shared/common.js";

export const KiwiConfigSchema = z.object({
  version: z.literal("1"),
  initializedAt: IsoDateTimeSchema.optional(),
  approver: z
    .object({
      identity: z.string().trim().min(1).optional(),
    })
    .optional(),
});

export const ModelProviderSchema = enumFrom(MODEL_PROVIDER_VALUES);
export const AccessModeSchema = enumFrom(ACCESS_MODE_VALUES);

export const PolicyRoutingOverrideSchema = z.object({
  agentRole: AgentRoleSchema,
  modelCapability: ModelCapabilitySchema,
});

export const ModelPricingSchema = z.object({
  currency: z.literal("USD"),
  inputUsdPerMillion: z.number().min(0),
  cacheReadUsdPerMillion: z.number().min(0).optional(),
  cacheWriteUsdPerMillion: z.number().min(0).optional(),
  outputUsdPerMillion: z.number().min(0),
  source: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
  sourceVersion: z.string().min(1).optional(),
  pricingLastVerifiedAt: IsoDateTimeSchema.optional(),
});

export const ProviderPreferenceSchema = z
  .object({
    planner: z.array(AccessModeSchema).optional(),
    researcher: z.array(AccessModeSchema).optional(),
    executor: z.array(AccessModeSchema).optional(),
    reviewer: z.array(AccessModeSchema).optional(),
    security: z.array(AccessModeSchema).optional(),
    rules: z.array(AccessModeSchema).optional(),
  })
  .default({});

export const CommandProfileSchema = z.object({
  allowedCommands: z.array(z.string().min(1)).default([]),
  approvalState: ApprovalStateSchema.default("auto"),
  approvalRequiredPaths: z.array(z.string()).default([]),
  deniedPaths: z.array(z.string()).default([]),
  envAllowlist: z.array(z.string()).default(["PATH"]),
  secretEnvNames: z.array(z.string()).default([]),
  networkPolicy: NetworkPolicySchema.default("disabled"),
  timeoutMs: z.number().int().positive().default(120_000),
  maxOutputBytes: z.number().int().positive().default(65536),
});

export const ExecutionIsolationSchema = enumFrom(EXECUTION_ISOLATION_VALUES);
export const CodexSandboxSchema = enumFrom(CODEX_SANDBOX_VALUES);
export const ExecutionOwnerSchema = enumFrom(EXECUTION_OWNER_VALUES);

export const ExecutionDefaultsSchema = z.object({
  owner: ExecutionOwnerSchema.default(ExecutionOwners.KiwiCodexCli),
  isolation: ExecutionIsolationSchema.default(ExecutionIsolations.Direct),
  sandbox: CodexSandboxSchema.default(CodexSandboxes.WorkspaceWrite),
  forbidStaging: z.boolean().default(true),
  forbidCommits: z.boolean().default(true),
  forbidPushes: z.boolean().default(true),
});

export const KiwiPolicySchema = z.object({
  version: z.literal("1"),
  project: z.object({
    name: z.string().min(1),
    language: z.string().min(1),
    packageManager: z.string().min(1),
  }),
  commands: z.object({
    test: z.string().min(1),
    lint: z.string().min(1),
    typecheck: z.string().min(1),
  }),
  routing: z.object({
    defaultAgentRole: AgentRoleSchema,
    defaultModelCapability: ModelCapabilitySchema,
    providerPreference: ProviderPreferenceSchema,
    stepTypeOverrides: z.record(z.string(), PolicyRoutingOverrideSchema).default({}),
  }),
  riskZones: z.object({
    high: z.array(z.string()).default([]),
  }),
  approvals: z.object({
    requireFor: z.array(z.string()).default([]),
    commandApprovalStates: z.record(z.string(), ApprovalStateSchema).default({}),
  }),
  commandProfiles: z.record(z.string(), CommandProfileSchema).default({}),
  execution: ExecutionDefaultsSchema.optional(),
});

export function defaultAccessModeForProvider(
  provider: z.infer<typeof ModelProviderSchema>,
): z.infer<typeof AccessModeSchema> {
  if (provider === ModelProviders.Anthropic) {
    return AccessModes.AnthropicApi;
  }
  if (provider === ModelProviders.Openai) {
    return AccessModes.OpenaiApi;
  }
  if (provider === ModelProviders.Local) {
    return AccessModes.Local;
  }

  return AccessModes.Stub;
}

export const ModelEntrySchema = z
  .object({
    id: z.string().min(1),
    providerModel: z.string().min(1).optional(),
    provider: ModelProviderSchema,
    capability: ModelCapabilitySchema,
    roles: z.array(AgentRoleSchema).min(1),
    pricing: ModelPricingSchema,
    enabled: z.boolean(),
    accessMode: AccessModeSchema.optional(),
    deprecatedAt: z.union([IsoDateTimeSchema, z.null()]).optional(),
    replacementModelId: z.union([z.string().min(1), z.null()]).optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.provider === ModelProviders.Stub) {
      return;
    }
    for (const key of ["source", "sourceUrl", "sourceVersion", "pricingLastVerifiedAt"] as const) {
      if (!entry.pricing[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pricing", key],
          message: `Real provider model '${entry.id}' must define pricing.${key}`,
        });
      }
    }
  })
  .transform((entry) => ({
    ...entry,
    accessMode: entry.accessMode ?? defaultAccessModeForProvider(entry.provider),
  }));

export const ModelRegistrySchema = z.object({
  version: z.literal("1"),
  catalogVersion: z.string().min(1).optional(),
  models: z.array(ModelEntrySchema).min(1),
});

export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type NetworkPolicy = z.infer<typeof NetworkPolicySchema>;
export type UsagePrecision = z.infer<typeof UsagePrecisionSchema>;
export type KiwiConfig = z.infer<typeof KiwiConfigSchema>;
export type PolicyRoutingOverride = z.infer<typeof PolicyRoutingOverrideSchema>;
export type ProviderPreference = z.infer<typeof ProviderPreferenceSchema>;
export type CommandProfile = z.infer<typeof CommandProfileSchema>;
export type ExecutionIsolation = z.infer<typeof ExecutionIsolationSchema>;
export type ExecutionOwner = z.infer<typeof ExecutionOwnerSchema>;
export type CodexSandbox = z.infer<typeof CodexSandboxSchema>;
export type ExecutionDefaults = z.infer<typeof ExecutionDefaultsSchema>;
export type KiwiPolicy = z.infer<typeof KiwiPolicySchema>;
export type ModelPricing = z.infer<typeof ModelPricingSchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type AccessMode = z.infer<typeof AccessModeSchema>;
export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;
export type BudgetProfile = z.infer<typeof BudgetProfileSchema>;
