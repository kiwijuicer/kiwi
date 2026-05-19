import { z } from "zod";
import {
  ACCESS_MODE_VALUES,
  ApprovalStateSchema,
  AgentRoleSchema,
  BudgetProfileSchema,
  ContextLevelSchema,
  ContractsSchemaVersionSchema,
  GateStatusSchema,
  GateTypeSchema,
  IsoDateTimeSchema,
  ModelCapabilitySchema,
  ModelInvocationPhaseSchema,
  ModelInvocationStatusSchema,
  MutationRequirementSchema,
  NEXT_ACTION_TYPE_VALUES,
  NetworkPolicySchema,
  RUNNER_EXECUTION_STATUS_VALUES,
  ReviewIssueSeveritySchema,
  ReviewVerdictValueSchema,
  RunStatusSchema,
  RunnerNameSchema,
  SchedulerDecisionStatusSchema,
  StepAttemptStatusSchema,
  StepTypeSchema,
  UsagePrecisionSchema,
  enumFrom,
} from "../shared/common";
import { ArtifactSchema } from "../domain";
import { EvidenceSubjectSchema } from "../evidence";
import { CodexSandboxSchema, ExecutionIsolationSchema, ExecutionOwnerSchema } from "../policy";

const InvocationAccessModeSchema = enumFrom(ACCESS_MODE_VALUES);

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
  accessMode: z.union([InvocationAccessModeSchema, z.null()]).optional(),
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

export const ResearchReportSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  initiativeId: z.string().regex(/^init_[a-z0-9_]+$/),
  relevantFiles: z.array(
    z.object({
      path: z.string().min(1),
      reason: z.string().min(1).optional(),
    }),
  ),
  symbolsOfInterest: z.array(
    z.object({
      name: z.string().min(1),
      kind: z.string().min(1).optional(),
      filePath: z.string().min(1).optional(),
    }),
  ),
  openQuestions: z.array(z.string().min(1)),
  summary: z.string().min(1).optional(),
  generatedAt: IsoDateTimeSchema,
});

const ContextPackageFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  truncated: z.boolean(),
  bytes: z.number().int().min(0),
});

export const ContextPackageSchema = z.object({
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  stepId: z.string().regex(/^step_\d{3}$/),
  attemptId: z.string().regex(/^attempt_[a-z0-9_]+$/),
  level: ContextLevelSchema,
  initiative: z.object({
    title: z.string().min(1),
    rawInput: z.string().min(1),
    riskProfile: z.string().min(1),
    budgetProfile: z.string().min(1),
  }),
  task: z.object({
    stepId: z.string().regex(/^step_\d{3}$/),
    type: StepTypeSchema,
    title: z.string().min(1),
    successCriteria: z.array(z.string().min(1)),
    requiredGates: z.array(z.string()),
    acceptanceCriteria: z.array(z.string().min(1)),
  }),
  mutationRequirement: MutationRequirementSchema,
  files: z.array(ContextPackageFileSchema),
  commands: z.object({
    test: z.string().min(1),
    lint: z.string().min(1),
    typecheck: z.string().min(1),
  }),
  budget: z.object({
    modelCapability: ModelCapabilitySchema,
    contextLevel: ContextLevelSchema,
    selectedModelId: z.union([z.string().min(1), z.null()]),
    selectedProviderModel: z.union([z.string().min(1), z.null()]),
    estimatedAttemptCostUsd: z.union([z.number().min(0), z.null()]),
  }),
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
  routingReason: z.array(z.string().min(1)).default([]),
  selectedModelId: z.union([z.string().min(1), z.null()]).optional(),
  selectedProviderModel: z.union([z.string().min(1), z.null()]).optional(),
  selectedAccessMode: z.union([InvocationAccessModeSchema, z.null()]).optional(),
  executorSelectionReason: z.union([z.string().min(1), z.null()]).optional(),
  estimatedAttemptCostUsd: z.number().min(0).optional(),
  executionOwner: ExecutionOwnerSchema.optional(),
  executionIsolation: ExecutionIsolationSchema.optional(),
  budget: z
    .object({
      profile: BudgetProfileSchema,
      softCapUsd: z.number().min(0),
      hardCapUsd: z.union([z.number().min(0), z.null()]),
      remainingUsdEstimate: z.union([z.number().min(0), z.null()]),
    })
    .optional(),
  contextPackageRef: z.string().min(1),
});

export const RunnerModelUsageSchema = ModelUsageSchema.extend({});

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
  executionMode: ExecutionIsolationSchema.optional(),
  codexSandbox: CodexSandboxSchema.optional(),
  diffBaseTree: z.union([z.string().min(1), z.null()]).optional(),
  step: z.object({
    stepId: z.string().regex(/^step_\d{3}$/),
    type: StepTypeSchema,
    title: z.string().min(1),
    successCriteria: z.array(z.string().min(1)),
    requiredGates: z.array(z.string()),
  }),
  contextPackage: ContextPackageSchema,
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
  executorCostUsd: z.number().min(0).default(0),
  reviewerCostUsd: z.number().min(0).default(0),
  runnerCostUsd: z.number().min(0),
  totalEstimatedUsd: z.number().min(0),
  usagePrecision: z
    .object({
      exact: z.number().int().min(0),
      estimated: z.number().int().min(0),
      unknown: z.number().int().min(0),
    })
    .default({ exact: 0, estimated: 0, unknown: 0 }),
  models: z
    .array(
      z.object({
        phase: ModelInvocationPhaseSchema,
        selectedCapability: ModelCapabilitySchema,
        modelId: z.union([z.string().min(1), z.null()]),
        providerName: z.string().min(1),
        runner: z.union([RunnerNameSchema, z.null()]),
        accessMode: z.union([InvocationAccessModeSchema, z.null()]).optional(),
      }),
    )
    .default([]),
  currency: z.literal("USD"),
  createdAt: IsoDateTimeSchema,
});

export const BudgetProfileLimitSchema = z.object({
  profile: BudgetProfileSchema,
  softCapUsd: z.number().min(0),
  hardCapUsd: z.union([z.number().min(0), z.null()]),
});

const UsagePrecisionCountsSchema = z.object({
  exact: z.number().int().min(0),
  estimated: z.number().int().min(0),
  unknown: z.number().int().min(0),
});

export const RunCompletionPhaseSummarySchema = z.object({
  phase: ModelInvocationPhaseSchema,
  costUsd: z.number().min(0),
  invocations: z.number().int().min(0),
  usagePrecision: UsagePrecisionCountsSchema,
  models: z.array(z.string().min(1)),
  accessModes: z.array(InvocationAccessModeSchema),
});

const RunCompletionStepCostSchema = z.object({
  planner: z.number().min(0),
  executor: z.number().min(0),
  reviewer: z.number().min(0),
});

export const RunCompletionSummarySchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  status: RunStatusSchema,
  totalEstimatedCostUsd: z.number().min(0),
  currency: z.literal("USD"),
  usagePrecision: UsagePrecisionCountsSchema,
  phaseCostsUsd: z.object({
    planner: z.number().min(0),
    executor: z.number().min(0),
    reviewer: z.number().min(0),
  }),
  phaseSummaries: z.object({
    planner: RunCompletionPhaseSummarySchema,
    executor: RunCompletionPhaseSummarySchema,
    reviewer: RunCompletionPhaseSummarySchema,
  }),
  byStepCostsUsd: z.record(z.string().min(1), RunCompletionStepCostSchema).default({}),
  byModelCostsUsd: z.record(z.string().min(1), z.number().min(0)).default({}),
  warnings: z.array(z.string().min(1)).default([]),
  attempts: z.object({
    total: z.number().int().min(0),
    completed: z.number().int().min(0),
    failed: z.number().int().min(0),
    blocked: z.number().int().min(0),
  }),
  failedStepIds: z.array(z.string().regex(/^step_\d{3}$/)),
  blockedStepIds: z.array(z.string().regex(/^step_\d{3}$/)),
  finalVerdict: z.union([ReviewVerdictValueSchema, z.literal("missing")]),
  safeToApply: z.union([z.boolean(), z.null()]),
  nextAction: z.string().min(1),
  compact: z.string().min(1),
  generatedAt: IsoDateTimeSchema,
});

export const ApprovalDecisionSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  stepId: z.string().regex(/^step_\d{3}$/),
  sourceAttemptId: z.string().regex(/^attempt_[a-z0-9_]+$/),
  approvalRequiredFiles: z.array(z.string().min(1)).min(1),
  state: ApprovalStateSchema,
  reason: z.string().min(1),
  approvedBy: z.string().min(1),
  createdAt: IsoDateTimeSchema,
});

export {
  AuditEventSchema,
  EvidenceFileHashSchema,
  EvidenceManifestSchema,
  EvidenceSubjectSchema,
  RunAuditSnapshotSchema,
} from "../evidence";
export type { AuditEvent, EvidenceFileHash, EvidenceManifest, EvidenceSubject, RunAuditSnapshot } from "../evidence";

export type ModelUsage = z.infer<typeof ModelUsageSchema>;
export type ModelInvocationRecord = z.infer<typeof ModelInvocationRecordSchema>;
export type ModelUsageSummaryTotals = z.infer<typeof ModelUsageSummaryTotalsSchema>;
export type ModelUsageSummary = z.infer<typeof ModelUsageSummarySchema>;
export type StepAttempt = z.infer<typeof StepAttemptSchema>;
export type GateResult = z.infer<typeof GateResultSchema>;
export type GateType = z.infer<typeof GateTypeSchema>;
export type GateStatus = z.infer<typeof GateStatusSchema>;
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
export type ReviewVerdictValue = z.infer<typeof ReviewVerdictValueSchema>;
export type ReviewIssueSeverity = z.infer<typeof ReviewIssueSeveritySchema>;
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
export type ContextPackage = z.infer<typeof ContextPackageSchema>;
export type ContextPackageFile = z.infer<typeof ContextPackageFileSchema>;
export type ContextLevel = z.infer<typeof ContextLevelSchema>;
export type SchedulerDecision = z.infer<typeof SchedulerDecisionSchema>;
export type SchedulerDecisionStatus = z.infer<typeof SchedulerDecisionStatusSchema>;
export type RunnerModelUsage = z.infer<typeof RunnerModelUsageSchema>;
export type RunnerExecutionError = z.infer<typeof RunnerExecutionErrorSchema>;
export type RunnerExecutionInput = z.infer<typeof RunnerExecutionInputSchema>;
export type RunnerExecutionOutput = z.infer<typeof RunnerExecutionOutputSchema>;
export type RunnerName = z.infer<typeof RunnerNameSchema>;
export type StepAttemptStatus = z.infer<typeof StepAttemptStatusSchema>;
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;
export type ModelInvocationPhase = z.infer<typeof ModelInvocationPhaseSchema>;
export type ModelInvocationStatus = z.infer<typeof ModelInvocationStatusSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type NetworkPolicy = z.infer<typeof NetworkPolicySchema>;
export type AttemptSummary = z.infer<typeof AttemptSummarySchema>;
export type FinalVerdict = z.infer<typeof FinalVerdictSchema>;
export type FinalCostReport = z.infer<typeof FinalCostReportSchema>;
export type BudgetProfileLimit = z.infer<typeof BudgetProfileLimitSchema>;
export type RunCompletionPhaseSummary = z.infer<typeof RunCompletionPhaseSummarySchema>;
export type RunCompletionSummary = z.infer<typeof RunCompletionSummarySchema>;
