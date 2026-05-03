import { z } from "zod";

export const IsoDateTimeSchema = z.string().datetime();
export const ContractsSchemaVersionSchema = z.literal("1");
export const ContractsSchemaEvolutionModeSchema = z.literal("breaking_allowed");

export const ContractsMetadataSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  evolutionMode: ContractsSchemaEvolutionModeSchema,
});

export const InitiativeSourceSchema = z.enum(["cli", "file", "mcp", "api"]);
export const RiskProfileSchema = z.enum(["local", "dev", "staging", "production"]);
export const BudgetProfileSchema = z.enum(["tiny", "small", "normal", "large", "critical"]);

export const AgentRoleSchema = z.enum([
  "planner",
  "researcher",
  "executor",
  "reviewer",
  "security",
  "rules",
]);

export const ModelCapabilitySchema = z.enum(["cheap", "mid", "strong", "frontier"]);
export const RunnerNameSchema = z.enum(["codex", "claude-code", "local-shell", "api"]);

export const StepTypeSchema = z.enum([
  "context_discovery",
  "planning",
  "test_creation",
  "coding",
  "validation",
  "review",
  "rules_update",
  "documentation",
]);

export const StepStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const RunStatusSchema = z.enum([
  "planned",
  "running",
  "needs_approval",
  "completed",
  "failed",
  "cancelled",
]);

export const StepAttemptStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
]);

export const ArtifactTypeSchema = z.enum([
  "diff",
  "patch",
  "command_output",
  "test_report",
  "lint_report",
  "typecheck_report",
  "review_report",
  "cost_report",
  "summary",
]);

export const GateTypeSchema = z.enum([
  "typecheck",
  "lint",
  "tests",
  "forbidden_file_checks",
  "secrets_check",
  "structured_review_json",
]);

export const GateStatusSchema = z.enum(["pass", "fail", "blocked"]);
export const ReviewVerdictValueSchema = z.enum([
  "pass",
  "pass_with_comments",
  "needs_changes",
  "reject",
]);
export const ReviewIssueSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const InitiativeSchema = z.object({
  id: z.string().regex(/^init_[a-z0-9_]+$/, "id must look like init_<value>"),
  title: z.string().min(1),
  rawInput: z.string().min(1),
  source: InitiativeSourceSchema,
  repoPath: z.string().min(1),
  riskProfile: RiskProfileSchema,
  budgetProfile: BudgetProfileSchema,
  createdAt: IsoDateTimeSchema,
});

export const StepSchema = z.object({
  stepId: z
    .string()
    .regex(/^step_\d{3}$/, "stepId must look like step_001"),
  type: StepTypeSchema,
  title: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  successCriteria: z.array(z.string()).min(1),
  requiredGates: z.array(z.string()).default([]),
  recommendedAgentRole: AgentRoleSchema,
  recommendedModelCapability: ModelCapabilitySchema,
  status: StepStatusSchema.default("pending"),
});

export const TaskGraphSchema = z.object({
  planId: z.string().regex(/^plan_[a-z0-9_]+$/),
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  initiativeId: z.string().regex(/^init_[a-z0-9_]+$/),
  summary: z.string().min(1),
  steps: z.array(StepSchema).min(1),
  acceptanceCriteria: z.array(z.string()).min(1),
  assumptions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  riskScore: z.number().int().min(1).max(5),
  complexityScore: z.number().int().min(1).max(5),
  createdAt: IsoDateTimeSchema,
});

export const RunSchema = z.object({
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  initiativeId: z.string().regex(/^init_[a-z0-9_]+$/),
  currentPlanId: z.string().regex(/^plan_[a-z0-9_]+$/),
  status: RunStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

// Backward compatibility alias while internal modules still import RunManifestSchema.
export const RunManifestSchema = RunSchema;

export const ArtifactSchema = z.object({
  type: ArtifactTypeSchema,
  ref: z.string().min(1),
  createdAt: IsoDateTimeSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const StepAttemptSchema = z.object({
  attemptId: z.string().regex(/^attempt_[a-z0-9_]+$/),
  stepId: z.string().regex(/^step_\d{3}$/),
  runner: RunnerNameSchema,
  agentRole: AgentRoleSchema,
  modelCapability: ModelCapabilitySchema,
  status: StepAttemptStatusSchema,
  contextPackageRef: z.string().min(1),
  artifacts: z.array(ArtifactSchema),
  startedAt: IsoDateTimeSchema,
  completedAt: z.union([IsoDateTimeSchema, z.null()]),
});

export const GateResultSchema = z.object({
  gateId: z.string().min(1),
  gateType: GateTypeSchema,
  status: GateStatusSchema,
  evidenceRefs: z.array(z.string().min(1)),
  reason: z.string().min(1),
});

export const ReviewIssueSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  severity: ReviewIssueSeveritySchema,
  detail: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  line: z.number().int().min(1).optional(),
});

export const ReviewVerdictSchema = z.object({
  verdict: ReviewVerdictValueSchema,
  safeToContinue: z.boolean(),
  issues: z.array(ReviewIssueSchema),
  recommendedNextSteps: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
});

export const PolicyRoutingOverrideSchema = z.object({
  agentRole: AgentRoleSchema,
  modelCapability: ModelCapabilitySchema,
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
    stepTypeOverrides: z.record(z.string(), PolicyRoutingOverrideSchema).default({}),
  }),
  riskZones: z.object({
    high: z.array(z.string()).default([]),
  }),
  approvals: z.object({
    requireFor: z.array(z.string()).default([]),
  }),
});

export const ModelProviderSchema = z.enum(["stub", "openai", "anthropic", "local"]);

export const ModelEntrySchema = z.object({
  id: z.string().min(1),
  provider: ModelProviderSchema,
  capability: ModelCapabilitySchema,
  roles: z.array(AgentRoleSchema).min(1),
  enabled: z.boolean(),
});

export const ModelRegistrySchema = z.object({
  version: z.literal("1"),
  models: z.array(ModelEntrySchema).min(1),
});

export type Initiative = z.infer<typeof InitiativeSchema>;
export type InitiativeSource = z.infer<typeof InitiativeSourceSchema>;
export type RiskProfile = z.infer<typeof RiskProfileSchema>;
export type BudgetProfile = z.infer<typeof BudgetProfileSchema>;
export type ContractsMetadata = z.infer<typeof ContractsMetadataSchema>;
export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;
export type RunnerName = z.infer<typeof RunnerNameSchema>;
export type StepType = z.infer<typeof StepTypeSchema>;
export type StepStatus = z.infer<typeof StepStatusSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type StepAttemptStatus = z.infer<typeof StepAttemptStatusSchema>;
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
export type GateType = z.infer<typeof GateTypeSchema>;
export type GateStatus = z.infer<typeof GateStatusSchema>;
export type ReviewVerdictValue = z.infer<typeof ReviewVerdictValueSchema>;
export type ReviewIssueSeverity = z.infer<typeof ReviewIssueSeveritySchema>;
export type Step = z.infer<typeof StepSchema>;
export type TaskGraph = z.infer<typeof TaskGraphSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunManifest = Run;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type StepAttempt = z.infer<typeof StepAttemptSchema>;
export type GateResult = z.infer<typeof GateResultSchema>;
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
export type PolicyRoutingOverride = z.infer<typeof PolicyRoutingOverrideSchema>;
export type KiwiPolicy = z.infer<typeof KiwiPolicySchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;
