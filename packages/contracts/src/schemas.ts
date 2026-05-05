import { z } from "zod";

export const IsoDateTimeSchema = z.string().datetime();
export const ContractsSchemaVersionSchema = z.literal("1");
export const ContractsSchemaEvolutionModeSchema = z.literal("breaking_allowed");
const enumFrom = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);

export const INITIATIVE_SOURCE_VALUES = ["cli", "file", "mcp", "api", "a2a"] as const;
export const RISK_PROFILE_VALUES = ["local", "dev", "staging", "production"] as const;
export const BUDGET_PROFILE_VALUES = ["tiny", "small", "normal", "large", "critical"] as const;
export const AGENT_ROLE_VALUES = ["planner", "researcher", "executor", "reviewer", "security", "rules"] as const;
export const MODEL_CAPABILITY_VALUES = ["cheap", "mid", "strong", "frontier"] as const;
export const RUNNER_NAME_VALUES = ["codex", "claude-code", "cursor-agent", "local-shell", "api"] as const;
export const STEP_TYPE_VALUES = [
  "context_discovery",
  "planning",
  "test_creation",
  "coding",
  "code_creation",
  "code_modification",
  "refactoring",
  "validation",
  "review",
  "scm_ticket",
  "scm_pull_request",
  "scm_review",
  "rules_update",
  "documentation",
] as const;
export const STEP_STATUS_VALUES = ["pending", "running", "completed", "failed", "skipped"] as const;
export const RUN_STATUS_VALUES = ["planned", "running", "needs_approval", "completed", "failed", "cancelled"] as const;
export const STEP_ATTEMPT_STATUS_VALUES = [
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
] as const;
export const ARTIFACT_TYPE_VALUES = [
  "diff",
  "patch",
  "command_output",
  "test_report",
  "lint_report",
  "typecheck_report",
  "review_report",
  "cost_report",
  "summary",
] as const;
export const GATE_TYPE_VALUES = [
  "typecheck",
  "lint",
  "tests",
  "forbidden_file_checks",
  "secrets_check",
  "structured_review_json",
] as const;
export const GATE_STATUS_VALUES = ["pass", "fail", "blocked"] as const;
export const APPROVAL_STATE_VALUES = ["auto", "required", "blocked"] as const;
export const NETWORK_POLICY_VALUES = ["disabled", "enabled"] as const;
export const CONTEXT_LEVEL_VALUES = ["L0", "L1", "L2", "L3"] as const;
export const SCHEDULER_DECISION_STATUS_VALUES = ["scheduled", "blocked"] as const;
export const MODEL_INVOCATION_PHASE_VALUES = ["planner", "executor", "reviewer"] as const;
export const MODEL_INVOCATION_STATUS_VALUES = ["completed", "failed", "blocked"] as const;
export const REVIEW_VERDICT_VALUE_VALUES = ["pass", "pass_with_comments", "needs_changes", "reject"] as const;
export const REVIEW_ISSUE_SEVERITY_VALUES = ["low", "medium", "high", "critical"] as const;
export const SCM_PROVIDER_VALUES = ["bitbucket-cloud", "github", "local"] as const;
export const SCM_MUTATION_STATUS_VALUES = ["draft", "created", "failed", "blocked"] as const;
export const RUNNER_EXECUTION_STATUS_VALUES = [
  "completed",
  "failed",
  "blocked",
  "approval_required",
  "timeout",
] as const;
export const NEXT_ACTION_TYPE_VALUES = ["continue", "fix_step", "replan"] as const;
export const PROTOCOL_ENVELOPE_KIND_VALUES = [
  "initiative",
  "task_graph",
  "step_attempt",
  "gate_result",
  "review_verdict",
  "artifact",
] as const;
export const A2A_RUNTIME_MODE_VALUES = ["disabled", "loopback", "filesystem"] as const;
export const A2A_RUNTIME_DECISION_STATUS_VALUES = ["accepted", "blocked", "duplicate"] as const;
export const MODEL_PROVIDER_VALUES = ["stub", "openai", "anthropic", "local"] as const;
export const ACCESS_MODE_VALUES = [
  "anthropic-api",
  "openai-api",
  "claude-code-cli",
  "cursor-agent-cli",
  "codex-cli",
  "cursor",
  "jetbrains",
  "local",
  "stub",
] as const;
export const USAGE_PRECISION_VALUES = ["exact", "estimated", "unknown"] as const;

export const InitiativeSources = {
  Cli: "cli",
  File: "file",
  Mcp: "mcp",
  Api: "api",
  A2a: "a2a",
} as const;

export const RiskProfiles = {
  Local: "local",
  Dev: "dev",
  Staging: "staging",
  Production: "production",
} as const;

export const BudgetProfiles = {
  Tiny: "tiny",
  Small: "small",
  Normal: "normal",
  Large: "large",
  Critical: "critical",
} as const;

export const AgentRoles = {
  Planner: "planner",
  Researcher: "researcher",
  Executor: "executor",
  Reviewer: "reviewer",
  Security: "security",
  Rules: "rules",
} as const;

export const ModelCapabilities = {
  Cheap: "cheap",
  Mid: "mid",
  Strong: "strong",
  Frontier: "frontier",
} as const;

export const RunnerNames = {
  Codex: "codex",
  ClaudeCode: "claude-code",
  CursorAgent: "cursor-agent",
  LocalShell: "local-shell",
  Api: "api",
} as const;

export const StepTypes = {
  ContextDiscovery: "context_discovery",
  Planning: "planning",
  TestCreation: "test_creation",
  Coding: "coding",
  CodeCreation: "code_creation",
  CodeModification: "code_modification",
  Refactoring: "refactoring",
  Validation: "validation",
  Review: "review",
  ScmTicket: "scm_ticket",
  ScmPullRequest: "scm_pull_request",
  ScmReview: "scm_review",
  RulesUpdate: "rules_update",
  Documentation: "documentation",
} as const;

export const StepStatuses = {
  Pending: "pending",
  Running: "running",
  Completed: "completed",
  Failed: "failed",
  Skipped: "skipped",
} as const;

export const RunStatuses = {
  Planned: "planned",
  Running: "running",
  NeedsApproval: "needs_approval",
  Completed: "completed",
  Failed: "failed",
  Cancelled: "cancelled",
} as const;

export const StepAttemptStatuses = {
  Pending: "pending",
  Running: "running",
  Completed: "completed",
  Failed: "failed",
  Blocked: "blocked",
  Cancelled: "cancelled",
} as const;

export const ArtifactTypes = {
  Diff: "diff",
  Patch: "patch",
  CommandOutput: "command_output",
  TestReport: "test_report",
  LintReport: "lint_report",
  TypecheckReport: "typecheck_report",
  ReviewReport: "review_report",
  CostReport: "cost_report",
  Summary: "summary",
} as const;

export const GateTypes = {
  Typecheck: "typecheck",
  Lint: "lint",
  Tests: "tests",
  ForbiddenFileChecks: "forbidden_file_checks",
  SecretsCheck: "secrets_check",
  StructuredReviewJson: "structured_review_json",
} as const;

export const GateStatuses = {
  Pass: "pass",
  Fail: "fail",
  Blocked: "blocked",
} as const;

export const ApprovalStates = {
  Auto: "auto",
  Required: "required",
  Blocked: "blocked",
} as const;

export const NetworkPolicies = {
  Disabled: "disabled",
  Enabled: "enabled",
} as const;

export const ContextLevels = {
  L0: "L0",
  L1: "L1",
  L2: "L2",
  L3: "L3",
} as const;

export const SchedulerDecisionStatuses = {
  Scheduled: "scheduled",
  Blocked: "blocked",
} as const;

export const ModelInvocationPhases = {
  Planner: "planner",
  Executor: "executor",
  Reviewer: "reviewer",
} as const;

export const ModelInvocationStatuses = {
  Completed: "completed",
  Failed: "failed",
  Blocked: "blocked",
} as const;

export const ReviewVerdictValues = {
  Pass: "pass",
  PassWithComments: "pass_with_comments",
  NeedsChanges: "needs_changes",
  Reject: "reject",
} as const;

export const ReviewIssueSeverities = {
  Low: "low",
  Medium: "medium",
  High: "high",
  Critical: "critical",
} as const;

export const ScmProviders = {
  BitbucketCloud: "bitbucket-cloud",
  Github: "github",
  Local: "local",
} as const;

export const ScmMutationStatuses = {
  Draft: "draft",
  Created: "created",
  Failed: "failed",
  Blocked: "blocked",
} as const;

export const RunnerExecutionStatuses = {
  Completed: "completed",
  Failed: "failed",
  Blocked: "blocked",
  ApprovalRequired: "approval_required",
  Timeout: "timeout",
} as const;

export const NextActionTypes = {
  Continue: "continue",
  FixStep: "fix_step",
  Replan: "replan",
} as const;

export const ProtocolEnvelopeKinds = {
  Initiative: "initiative",
  TaskGraph: "task_graph",
  StepAttempt: "step_attempt",
  GateResult: "gate_result",
  ReviewVerdict: "review_verdict",
  Artifact: "artifact",
} as const;

export const A2ARuntimeModes = {
  Disabled: "disabled",
  Loopback: "loopback",
  Filesystem: "filesystem",
} as const;

export const A2ARuntimeDecisionStatuses = {
  Accepted: "accepted",
  Blocked: "blocked",
  Duplicate: "duplicate",
} as const;

export const ModelProviders = {
  Stub: "stub",
  Openai: "openai",
  Anthropic: "anthropic",
  Local: "local",
} as const;

export const AccessModes = {
  AnthropicApi: "anthropic-api",
  OpenaiApi: "openai-api",
  ClaudeCodeCli: "claude-code-cli",
  CursorAgentCli: "cursor-agent-cli",
  CodexCli: "codex-cli",
  Cursor: "cursor",
  Jetbrains: "jetbrains",
  Local: "local",
  Stub: "stub",
} as const;

export const ContractValues = {
  Planner: AgentRoles.Planner,
  Researcher: AgentRoles.Researcher,
  Executor: AgentRoles.Executor,
  Reviewer: AgentRoles.Reviewer,
  Security: AgentRoles.Security,
  Rules: AgentRoles.Rules,
  Cheap: ModelCapabilities.Cheap,
  Mid: ModelCapabilities.Mid,
  Strong: ModelCapabilities.Strong,
  Frontier: ModelCapabilities.Frontier,
  Typecheck: GateTypes.Typecheck,
  Lint: GateTypes.Lint,
  Tests: GateTypes.Tests,
  Pass: GateStatuses.Pass,
  Fail: GateStatuses.Fail,
  Blocked: GateStatuses.Blocked,
  Pending: StepAttemptStatuses.Pending,
  Running: RunStatuses.Running,
  Completed: RunStatuses.Completed,
  Failed: RunStatuses.Failed,
  Cancelled: RunStatuses.Cancelled,
  NeedsChanges: ReviewVerdictValues.NeedsChanges,
  PassWithComments: ReviewVerdictValues.PassWithComments,
  Reject: ReviewVerdictValues.Reject,
  BitbucketCloud: ScmProviders.BitbucketCloud,
  Github: ScmProviders.Github,
  Local: ScmProviders.Local,
} as const;

export const ContractsMetadataSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  evolutionMode: ContractsSchemaEvolutionModeSchema,
});

export const InitiativeSourceSchema = enumFrom(INITIATIVE_SOURCE_VALUES);
export const RiskProfileSchema = enumFrom(RISK_PROFILE_VALUES);
export const BudgetProfileSchema = enumFrom(BUDGET_PROFILE_VALUES);
export const AgentRoleSchema = enumFrom(AGENT_ROLE_VALUES);
export const ModelCapabilitySchema = enumFrom(MODEL_CAPABILITY_VALUES);
export const RunnerNameSchema = enumFrom(RUNNER_NAME_VALUES);
export const StepTypeSchema = enumFrom(STEP_TYPE_VALUES);
export const StepStatusSchema = enumFrom(STEP_STATUS_VALUES);
export const RunStatusSchema = enumFrom(RUN_STATUS_VALUES);
export const StepAttemptStatusSchema = enumFrom(STEP_ATTEMPT_STATUS_VALUES);
export const ArtifactTypeSchema = enumFrom(ARTIFACT_TYPE_VALUES);
export const GateTypeSchema = enumFrom(GATE_TYPE_VALUES);
export const GateStatusSchema = enumFrom(GATE_STATUS_VALUES);
export const ApprovalStateSchema = enumFrom(APPROVAL_STATE_VALUES);
export const NetworkPolicySchema = enumFrom(NETWORK_POLICY_VALUES);
export const ContextLevelSchema = enumFrom(CONTEXT_LEVEL_VALUES);
export const SchedulerDecisionStatusSchema = enumFrom(SCHEDULER_DECISION_STATUS_VALUES);
export const ModelInvocationPhaseSchema = enumFrom(MODEL_INVOCATION_PHASE_VALUES);
export const ModelInvocationStatusSchema = enumFrom(MODEL_INVOCATION_STATUS_VALUES);
export const UsagePrecisionSchema = enumFrom(USAGE_PRECISION_VALUES);
export const ReviewVerdictValueSchema = enumFrom(REVIEW_VERDICT_VALUE_VALUES);
export const ReviewIssueSeveritySchema = enumFrom(REVIEW_ISSUE_SEVERITY_VALUES);
export const ScmProviderSchema = enumFrom(SCM_PROVIDER_VALUES);
export const ScmAuthModeSchema = z.literal("external");
export const ScmMutationStatusSchema = enumFrom(SCM_MUTATION_STATUS_VALUES);

export const ScmRepositoryRefSchema = z
  .object({
    provider: ScmProviderSchema,
    workspace: z.string().min(1).optional(),
    repoSlug: z.string().min(1).optional(),
    remoteUrl: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.provider !== "bitbucket-cloud") return;
    if (!value.workspace) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspace"],
        message: "bitbucket-cloud repository refs require workspace",
      });
    }
    if (!value.repoSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repoSlug"],
        message: "bitbucket-cloud repository refs require repoSlug",
      });
    }
  });

export const ScmTicketDraftSchema = z.object({
  repository: ScmRepositoryRefSchema,
  title: z.string().min(1),
  body: z.string().default(""),
  labels: z.array(z.string().min(1)).default([]),
});

export const ScmPullRequestDraftSchema = z.object({
  repository: ScmRepositoryRefSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  sourceBranch: z.string().min(1),
  destinationBranch: z.string().min(1).optional(),
  closeSourceBranch: z.boolean().default(false),
  draft: z.boolean().default(false),
});

export const ScmPullRequestReviewCommentSchema = z.object({
  body: z.string().min(1),
  filePath: z.string().min(1).optional(),
  line: z.number().int().min(1).optional(),
  severity: ReviewIssueSeveritySchema.optional(),
  createTask: z.boolean().default(false),
});

export const ScmPullRequestReviewDraftSchema = z.object({
  repository: ScmRepositoryRefSchema,
  pullRequestId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  summary: z.string().default(""),
  comments: z.array(ScmPullRequestReviewCommentSchema).default([]),
  requestChanges: z.boolean().default(false),
});

export const ScmMutationResultSchema = z.object({
  provider: ScmProviderSchema,
  authMode: ScmAuthModeSchema,
  status: ScmMutationStatusSchema,
  externalId: z.string().min(1).optional(),
  externalUrl: z.string().min(1).optional(),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  createdAt: IsoDateTimeSchema.optional(),
});

export const EvidenceSubjectSchema = z.object({
  type: z.literal("diff"),
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

export const PrDraftArtifactSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  repository: ScmRepositoryRefSchema,
  remote: z.string().min(1),
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  createUrl: z.string().url(),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  diffHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  pushedAt: IsoDateTimeSchema.optional(),
  createdAt: IsoDateTimeSchema,
});

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
  stepId: z.string().regex(/^step_\d{3}$/, "stepId must look like step_001"),
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
  workspacePath: z.string().min(1).optional(),
  repoId: z.string().min(1).optional(),
  repoPath: z.string().min(1).optional(),
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

export const ModelUsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
});

export const ModelInvocationRecordSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  phase: ModelInvocationPhaseSchema,
  stepId: z
    .string()
    .regex(/^step_\d{3}$/)
    .optional(),
  attemptId: z
    .string()
    .regex(/^attempt_[a-z0-9_]+$/)
    .optional(),
  agentRole: AgentRoleSchema,
  requestedCapability: ModelCapabilitySchema.optional(),
  selectedCapability: ModelCapabilitySchema,
  modelId: z.union([z.string().min(1), z.null()]),
  providerName: z.string().min(1),
  runner: z.union([RunnerNameSchema, z.null()]),
  usage: ModelUsageSchema,
  usagePrecision: UsagePrecisionSchema.default("unknown"),
  estimatedCostUsd: z.union([z.number().min(0), z.null()]),
  status: ModelInvocationStatusSchema,
  evidenceRefs: z.array(z.string().min(1)).default([]),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
});

export const ModelUsageSummaryTotalsSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  estimatedCostUsd: z.number().min(0),
});

export const ModelUsageSummarySchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  invocationCount: z.number().int().min(0),
  totals: ModelUsageSummaryTotalsSchema,
  byPhase: z.record(ModelInvocationPhaseSchema, ModelUsageSummaryTotalsSchema),
  invocations: z.array(ModelInvocationRecordSchema),
  generatedAt: IsoDateTimeSchema,
});

export const StepAttemptSchema = z.object({
  attemptId: z.string().regex(/^attempt_[a-z0-9_]+$/),
  stepId: z.string().regex(/^step_\d{3}$/),
  runner: RunnerNameSchema,
  agentRole: AgentRoleSchema,
  modelCapability: ModelCapabilitySchema,
  status: StepAttemptStatusSchema,
  contextPackageRef: z.string().min(1),
  modelInvocationRefs: z.array(z.string().min(1)).default([]),
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
  subject: EvidenceSubjectSchema.optional(),
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
  subject: EvidenceSubjectSchema.optional(),
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

export const RunnerModelUsageSchema = ModelUsageSchema;

export const RunnerExecutionErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const RunnerExecutionInputSchema = z.object({
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  stepId: z.string().regex(/^step_\d{3}$/),
  attemptId: z.string().regex(/^attempt_[a-z0-9_]+$/),
  workspacePath: z.string().min(1),
  repoPath: z.string().min(1).optional(),
  worktreePath: z.string().min(1),
  stepPrompt: z.string(),
  contextPackage: z.unknown(),
  allowedTools: z.array(z.string()),
  timeouts: z.object({
    commandTimeoutMs: z.number().int().positive(),
  }),
});

export const RunnerExecutionOutputSchema = z.object({
  status: enumFrom(RUNNER_EXECUTION_STATUS_VALUES),
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
  runnerStatus: enumFrom(RUNNER_EXECUTION_STATUS_VALUES),
  nextAction: z.object({
    type: enumFrom(NEXT_ACTION_TYPE_VALUES),
    reason: z.string().min(1),
    recommendedNextSteps: z.array(z.string()),
    issueCodes: z.array(z.string()),
  }),
  gateResultsRef: z.string().min(1),
  reviewReportRef: z.string().min(1),
  costReportRef: z.string().min(1),
  modelInvocationRefs: z.array(z.string()).default([]),
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

export const ProtocolEnvelopeKindSchema = enumFrom(PROTOCOL_ENVELOPE_KIND_VALUES);

export const A2AAttachmentDescriptorSchema = z.object({
  ref: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(0),
  mediaType: z.string().min(1),
});

export const A2AMessageMetadataSchema = z.object({
  messageId: z.string().regex(/^msg_[a-z0-9_]+$/),
  correlationId: z.string().regex(/^corr_[a-z0-9_]+$/),
  idempotencyKey: z.string().min(8),
  senderAgentId: z.string().min(1),
  recipientAgentId: z.string().min(1),
  attachments: z.array(A2AAttachmentDescriptorSchema).optional(),
});

export const ProtocolEnvelopeSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  protocol: z.literal("a2a-prep"),
  kind: ProtocolEnvelopeKindSchema,
  payload: z.unknown(),
  createdAt: IsoDateTimeSchema,
  a2a: A2AMessageMetadataSchema.optional(),
});

export const A2ARuntimeModeSchema = enumFrom(A2A_RUNTIME_MODE_VALUES);
export const A2ARuntimeDecisionStatusSchema = enumFrom(A2A_RUNTIME_DECISION_STATUS_VALUES);

export const A2ARuntimeDecisionSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  status: A2ARuntimeDecisionStatusSchema,
  reason: z.string().min(1),
  messageId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  runId: z
    .string()
    .regex(/^run_[a-z0-9_]+$/)
    .optional(),
  inboxRef: z.string().min(1).optional(),
  quarantineRef: z.string().min(1).optional(),
  duplicateOfRef: z.string().min(1).optional(),
  createdAt: IsoDateTimeSchema,
});

export const A2ATrustedPeerSchema = z.object({
  agentId: z.string().min(1),
  inboxPath: z.string().min(1),
  allowRemotePatches: z.boolean().default(false),
});

export const A2AConfigSchema = z.object({
  enabled: z.boolean().default(false),
  localAgentId: z.string().min(1).default("kiwi-local"),
  acceptedKinds: z
    .array(ProtocolEnvelopeKindSchema)
    .default(["initiative", "task_graph", "step_attempt", "gate_result", "review_verdict", "artifact"]),
  peers: z.array(A2ATrustedPeerSchema).default([]),
});

export const KiwiConfigSchema = z.object({
  version: z.literal("1"),
  initializedAt: IsoDateTimeSchema.optional(),
  a2a: A2AConfigSchema.default({}),
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

export const ModelProviderSchema = enumFrom(MODEL_PROVIDER_VALUES);
export const AccessModeSchema = enumFrom(ACCESS_MODE_VALUES);

export function defaultAccessModeForProvider(
  provider: z.infer<typeof ModelProviderSchema>,
): z.infer<typeof AccessModeSchema> {
  if (provider === "anthropic") return "anthropic-api";
  if (provider === "openai") return "openai-api";
  if (provider === "local") return "local";
  return "stub";
}

export const ModelEntrySchema = z
  .object({
    id: z.string().min(1),
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
