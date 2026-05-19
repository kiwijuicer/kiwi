import { z } from "zod";

export const IsoDateTimeSchema = z.string().datetime();
export const ContractsSchemaVersionSchema = z.literal("1");
export const ContractsSchemaEvolutionModeSchema = z.literal("breaking_allowed");
export const enumFrom = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);

export const INITIATIVE_SOURCE_VALUES = ["cli", "file", "mcp", "api"] as const;
export const RISK_PROFILE_VALUES = ["local", "dev", "staging", "production"] as const;
export const BUDGET_PROFILE_VALUES = ["tiny", "small", "normal", "large", "critical"] as const;
export const AGENT_ROLE_VALUES = ["planner", "researcher", "executor", "reviewer", "security", "rules"] as const;
export const MODEL_CAPABILITY_VALUES = ["cheap", "mid", "strong", "frontier"] as const;
export const RUNNER_NAME_VALUES = ["codex", "claude-code", "cursor-agent", "local-shell", "stub", "api"] as const;
export const MUTATION_REQUIREMENT_VALUES = ["must_change_files", "may_change_files", "no_file_changes"] as const;
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
export const PROGRESS_STATUS_VALUES = [
  "started",
  "selected",
  "running",
  "completed",
  "failed",
  "blocked",
  "skipped",
] as const;
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
  "diff_required",
  "command_policy",
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
export const EXECUTION_ISOLATION_VALUES = ["direct", "worktree"] as const;
export const CODEX_SANDBOX_VALUES = ["read-only", "workspace-write", "danger-full-access"] as const;
export const EXECUTION_OWNER_VALUES = ["kiwi-codex-cli"] as const;
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
  Stub: "stub",
  Api: "api",
} as const;

export const MutationRequirements = {
  MustChangeFiles: "must_change_files",
  MayChangeFiles: "may_change_files",
  NoFileChanges: "no_file_changes",
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

export const ProgressStatuses = {
  Started: "started",
  Selected: "selected",
  Running: "running",
  Completed: "completed",
  Failed: "failed",
  Blocked: "blocked",
  Skipped: "skipped",
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
  DiffRequired: "diff_required",
  CommandPolicy: "command_policy",
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

export const ExecutionIsolations = {
  Direct: "direct",
  Worktree: "worktree",
} as const;

export const CodexSandboxes = {
  ReadOnly: "read-only",
  WorkspaceWrite: "workspace-write",
  DangerFullAccess: "danger-full-access",
} as const;

export const ExecutionOwners = {
  KiwiCodexCli: "kiwi-codex-cli",
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
  DiffRequired: GateTypes.DiffRequired,
  CommandPolicy: GateTypes.CommandPolicy,
  Pass: GateStatuses.Pass,
  Fail: GateStatuses.Fail,
  Blocked: GateStatuses.Blocked,
  Pending: StepAttemptStatuses.Pending,
  Scheduled: SchedulerDecisionStatuses.Scheduled,
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
  Direct: ExecutionIsolations.Direct,
  Worktree: ExecutionIsolations.Worktree,
  KiwiCodexCli: ExecutionOwners.KiwiCodexCli,
  WorkspaceWrite: CodexSandboxes.WorkspaceWrite,
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
export const MutationRequirementSchema = enumFrom(MUTATION_REQUIREMENT_VALUES);
export const StepTypeSchema = enumFrom(STEP_TYPE_VALUES);
export const StepStatusSchema = enumFrom(STEP_STATUS_VALUES);
export const RunStatusSchema = enumFrom(RUN_STATUS_VALUES);
export const ProgressStatusSchema = enumFrom(PROGRESS_STATUS_VALUES);
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
export const RunnerExecutionStatusSchema = enumFrom(RUNNER_EXECUTION_STATUS_VALUES);
export const NextActionTypeSchema = enumFrom(NEXT_ACTION_TYPE_VALUES);
export const UsagePrecisionSchema = enumFrom(USAGE_PRECISION_VALUES);
export const ReviewVerdictValueSchema = enumFrom(REVIEW_VERDICT_VALUE_VALUES);
export const ReviewIssueSeveritySchema = enumFrom(REVIEW_ISSUE_SEVERITY_VALUES);
export const ScmProviderSchema = enumFrom(SCM_PROVIDER_VALUES);
export const ScmAuthModeSchema = z.literal("external");
export const ScmMutationStatusSchema = enumFrom(SCM_MUTATION_STATUS_VALUES);
