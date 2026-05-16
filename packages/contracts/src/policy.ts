import { z } from "zod";
import {
  ACCESS_MODE_VALUES,
  AccessModes,
  AgentRoleSchema,
  ApprovalStateSchema,
  BudgetProfileSchema,
  IsoDateTimeSchema,
  MODEL_PROVIDER_VALUES,
  ModelProviders,
  ModelCapabilitySchema,
  NetworkPolicySchema,
  UsagePrecisionSchema,
  enumFrom,
} from "./common";

export const KiwiConfigSchema = z.object({
  version: z.literal("1"),
  initializedAt: IsoDateTimeSchema.optional(),
});

export const ModelProviderSchema = enumFrom(MODEL_PROVIDER_VALUES);
export const AccessModeSchema = enumFrom(ACCESS_MODE_VALUES);

export const PolicyRoutingOverrideSchema = z.object({
  agentRole: AgentRoleSchema,
  modelCapability: ModelCapabilitySchema,
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

export const ExecutionIsolationSchema = z.enum(["direct", "worktree"]);
export const CodexSandboxSchema = z.enum(["read-only", "workspace-write", "danger-full-access"]);

export const ExecutionDefaultsSchema = z.object({
  owner: z.literal("kiwi-codex-cli").default("kiwi-codex-cli"),
  isolation: ExecutionIsolationSchema.default("direct"),
  sandbox: CodexSandboxSchema.default("workspace-write"),
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
  if (provider === ModelProviders.Anthropic) return AccessModes.AnthropicApi;
  if (provider === ModelProviders.Openai) return AccessModes.OpenaiApi;
  if (provider === ModelProviders.Local) return AccessModes.Local;
  return AccessModes.Stub;
}

export const ModelEntrySchema = z
  .object({
    id: z.string().min(1),
    providerModel: z.string().min(1).optional(),
    provider: ModelProviderSchema,
    capability: ModelCapabilitySchema,
    roles: z.array(AgentRoleSchema).min(1),
    enabled: z.boolean(),
    accessMode: AccessModeSchema.optional(),
  })
  .transform((entry) => ({
    ...entry,
    accessMode: entry.accessMode ?? defaultAccessModeForProvider(entry.provider),
  }));

export const ModelRegistrySchema = z.object({
  version: z.literal("1"),
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
export type CodexSandbox = z.infer<typeof CodexSandboxSchema>;
export type ExecutionDefaults = z.infer<typeof ExecutionDefaultsSchema>;
export type KiwiPolicy = z.infer<typeof KiwiPolicySchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type AccessMode = z.infer<typeof AccessModeSchema>;
export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;
export type BudgetProfile = z.infer<typeof BudgetProfileSchema>;
