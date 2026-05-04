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
export const ApprovalStateSchema = z.enum(["auto", "required", "blocked"]);
export const NetworkPolicySchema = z.enum(["disabled", "enabled"]);
export const ContextLevelSchema = z.enum(["L0", "L1", "L2", "L3"]);
export const SchedulerDecisionStatusSchema = z.enum(["scheduled", "blocked"]);
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

export const ContextPackageSchema = z.object({
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  stepId: z.string().regex(/^step_\d{3}$/),
  attemptId: z.string().regex(/^attempt_[a-z0-9_]+$/),
  level: ContextLevelSchema,
  include: z.object({
    initiative: z.boolean(),
    policy: z.boolean(),
    registry: z.boolean(),
    commands: z.boolean(),
    relevantFiles: z.array(z.string()),
    tests: z.array(z.string()),
    recentDiffFiles: z.array(z.string()),
    symbolHits: z.array(z.string()),
    traces: z.array(z.string()),
    architectureFiles: z.array(z.string()),
    historicalOutcomeRefs: z.array(z.string()),
  }),
  generatedAt: IsoDateTimeSchema,
});

export const SchedulerDecisionSchema = z.object({
  status: SchedulerDecisionStatusSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  stepId: z.string().regex(/^step_\d{3}$/),
  attemptId: z.string().regex(/^attempt_[a-z0-9_]+$/),
  blockedReason: z.string().min(1).optional(),
  agentRole: AgentRoleSchema,
  modelCapability: ModelCapabilitySchema,
  runner: z.union([RunnerNameSchema, z.null()]),
  contextLevel: ContextLevelSchema,
  reviewDepth: ModelCapabilitySchema,
  requiredGates: z.array(z.string()),
  contextPackageRef: z.string().min(1),
});

export const RunnerModelUsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
});

export const RunnerExecutionErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const RunnerExecutionInputSchema = z.object({
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  stepId: z.string().regex(/^step_\d{3}$/),
  attemptId: z.string().regex(/^attempt_[a-z0-9_]+$/),
  workspacePath: z.string().min(1),
  worktreePath: z.string().min(1),
  stepPrompt: z.string(),
  contextPackage: z.unknown(),
  allowedTools: z.array(z.string()),
  timeouts: z.object({
    commandTimeoutMs: z.number().int().positive(),
  }),
});

export const RunnerExecutionOutputSchema = z.object({
  status: z.enum(["completed", "failed", "blocked", "approval_required", "timeout"]),
  artifactRefs: z.array(ArtifactSchema),
  rawLogsRef: z.union([z.string().min(1), z.null()]),
  modelUsage: RunnerModelUsageSchema,
  gateResult: GateResultSchema,
  error: RunnerExecutionErrorSchema.optional(),
});

export const AttemptSummarySchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  stepId: z.string().regex(/^step_\d{3}$/),
  attemptId: z.string().regex(/^attempt_[a-z0-9_]+$/),
  status: StepAttemptStatusSchema,
  runnerStatus: z.enum(["completed", "failed", "blocked", "approval_required", "timeout"]),
  nextAction: z.object({
    type: z.enum(["continue", "fix_step", "replan"]),
    reason: z.string().min(1),
    recommendedNextSteps: z.array(z.string()),
    issueCodes: z.array(z.string()),
  }),
  gateResultsRef: z.string().min(1),
  reviewReportRef: z.string().min(1),
  costReportRef: z.string().min(1),
  artifactRefs: z.array(z.string()),
  completedAt: IsoDateTimeSchema,
  error: RunnerExecutionErrorSchema.optional(),
});

export const FinalVerdictSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  verdict: ReviewVerdictValueSchema,
  safeToApply: z.boolean(),
  completedStepIds: z.array(z.string().regex(/^step_\d{3}$/)),
  failedStepIds: z.array(z.string().regex(/^step_\d{3}$/)),
  blockedStepIds: z.array(z.string().regex(/^step_\d{3}$/)),
  missingStepIds: z.array(z.string().regex(/^step_\d{3}$/)),
  gateResultRefs: z.array(z.string()),
  reviewReportRefs: z.array(z.string()),
  reason: z.string().min(1),
  createdAt: IsoDateTimeSchema,
});

export const FinalCostReportSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  plannerCostUsd: z.number().min(0),
  runnerCostUsd: z.number().min(0),
  totalEstimatedUsd: z.number().min(0),
  currency: z.literal("USD"),
  createdAt: IsoDateTimeSchema,
});

export const AuditEventSchema = z.object({
  eventType: z.string().min(1),
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  timestamp: IsoDateTimeSchema,
  payload: z.record(z.string(), z.unknown()),
});

export const EvidenceFileHashSchema = z.object({
  ref: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(0),
});

export const RunAuditSnapshotSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  eventCount: z.number().int().min(0),
  events: z.array(AuditEventSchema),
  createdAt: IsoDateTimeSchema,
});

export const EvidenceManifestSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  generatedAt: IsoDateTimeSchema,
  auditSnapshotRef: z.string().min(1),
  files: z.array(EvidenceFileHashSchema),
});

export const ApprovalDecisionSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  attemptId: z.string().regex(/^attempt_[a-z0-9_]+$/),
  state: ApprovalStateSchema,
  reason: z.string().min(1),
  approvedBy: z.string().min(1),
  createdAt: IsoDateTimeSchema,
});

export const ProtocolEnvelopeKindSchema = z.enum([
  "initiative",
  "task_graph",
  "step_attempt",
  "gate_result",
  "review_verdict",
  "artifact",
]);

export const ProtocolEnvelopeSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  protocol: z.literal("a2a-prep"),
  kind: ProtocolEnvelopeKindSchema,
  payload: z.unknown(),
  createdAt: IsoDateTimeSchema,
});

export const PolicyRoutingOverrideSchema = z.object({
  agentRole: AgentRoleSchema,
  modelCapability: ModelCapabilitySchema,
});

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
    commandApprovalStates: z.record(z.string(), ApprovalStateSchema).default({}),
  }),
  commandProfiles: z.record(z.string(), CommandProfileSchema).default({}),
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
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type NetworkPolicy = z.infer<typeof NetworkPolicySchema>;
export type ContextLevel = z.infer<typeof ContextLevelSchema>;
export type SchedulerDecisionStatus = z.infer<typeof SchedulerDecisionStatusSchema>;
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
export type ContextPackage = z.infer<typeof ContextPackageSchema>;
export type SchedulerDecision = z.infer<typeof SchedulerDecisionSchema>;
export type RunnerModelUsage = z.infer<typeof RunnerModelUsageSchema>;
export type RunnerExecutionError = z.infer<typeof RunnerExecutionErrorSchema>;
export type RunnerExecutionInput = z.infer<typeof RunnerExecutionInputSchema>;
export type RunnerExecutionOutput = z.infer<typeof RunnerExecutionOutputSchema>;
export type AttemptSummary = z.infer<typeof AttemptSummarySchema>;
export type FinalVerdict = z.infer<typeof FinalVerdictSchema>;
export type FinalCostReport = z.infer<typeof FinalCostReportSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type EvidenceFileHash = z.infer<typeof EvidenceFileHashSchema>;
export type RunAuditSnapshot = z.infer<typeof RunAuditSnapshotSchema>;
export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type ProtocolEnvelopeKind = z.infer<typeof ProtocolEnvelopeKindSchema>;
export type ProtocolEnvelope = z.infer<typeof ProtocolEnvelopeSchema>;
export type PolicyRoutingOverride = z.infer<typeof PolicyRoutingOverrideSchema>;
export type CommandProfile = z.infer<typeof CommandProfileSchema>;
export type KiwiPolicy = z.infer<typeof KiwiPolicySchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;
