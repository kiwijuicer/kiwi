import { z } from "zod";
import {
  ApprovalStateSchema,
  AgentRoleSchema,
  ContextLevelSchema,
  ContractsSchemaVersionSchema,
  GateStatusSchema,
  GateTypeSchema,
  IsoDateTimeSchema,
  ModelCapabilitySchema,
  ModelInvocationPhaseSchema,
  ModelInvocationStatusSchema,
  NEXT_ACTION_TYPE_VALUES,
  NetworkPolicySchema,
  RUNNER_EXECUTION_STATUS_VALUES,
  ReviewIssueSeveritySchema,
  ReviewVerdictValueSchema,
  RunnerNameSchema,
  SchedulerDecisionStatusSchema,
  StepAttemptStatusSchema,
  UsagePrecisionSchema,
  enumFrom,
} from "./common";
import { ArtifactSchema } from "./domain";
import { EvidenceSubjectSchema } from "./evidence";

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

export const ApprovalDecisionSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  attemptId: z.string().regex(/^attempt_[a-z0-9_]+$/),
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
} from "./evidence";
export type { AuditEvent, EvidenceFileHash, EvidenceManifest, EvidenceSubject, RunAuditSnapshot } from "./evidence";

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
export type ContextPackage = z.infer<typeof ContextPackageSchema>;
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
