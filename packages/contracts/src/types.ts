import type { z } from "zod";
import type {
  A2AAttachmentDescriptorSchema,
  A2AConfigSchema,
  A2AMessageMetadataSchema,
  A2ARuntimeDecisionSchema,
  A2ARuntimeDecisionStatusSchema,
  A2ARuntimeModeSchema,
  A2ATrustedPeerSchema,
  AccessModeSchema,
  AgentRoleSchema,
  ApprovalDecisionSchema,
  ApprovalStateSchema,
  ArtifactSchema,
  ArtifactTypeSchema,
  AttemptSummarySchema,
  AuditEventSchema,
  BudgetProfileLimitSchema,
  BudgetProfileSchema,
  CodexSandboxSchema,
  CommandProfileSchema,
  ContextLevelSchema,
  ContextPackageSchema,
  ContractsMetadataSchema,
  ExecutionDefaultsSchema,
  ExecutionIsolationSchema,
  EvidenceFileHashSchema,
  EvidenceManifestSchema,
  EvidenceSubjectSchema,
  FinalCostReportSchema,
  FinalVerdictSchema,
  GateResultSchema,
  GateStatusSchema,
  GateTypeSchema,
  InitiativeSchema,
  InitiativeSourceSchema,
  KiwiConfigSchema,
  KiwiPolicySchema,
  ModelCapabilitySchema,
  ModelEntrySchema,
  ModelInvocationPhaseSchema,
  ModelInvocationRecordSchema,
  ModelInvocationStatusSchema,
  ModelProviderSchema,
  ModelRegistrySchema,
  ModelUsageSchema,
  ModelUsageSummarySchema,
  ModelUsageSummaryTotalsSchema,
  NetworkPolicySchema,
  PolicyRoutingOverrideSchema,
  ProviderPreferenceSchema,
  PrDraftArtifactSchema,
  ProtocolEnvelopeKindSchema,
  ProtocolEnvelopeSchema,
  ReviewIssueSchema,
  ReviewIssueSeveritySchema,
  ReviewVerdictSchema,
  ReviewVerdictValueSchema,
  ResearchReportSchema,
  RiskProfileSchema,
  RunAuditSnapshotSchema,
  RunCompletionPhaseSummarySchema,
  RunCompletionSummarySchema,
  RunSchema,
  RunStatusSchema,
  RunnerExecutionErrorSchema,
  RunnerExecutionInputSchema,
  RunnerExecutionOutputSchema,
  RunnerModelUsageSchema,
  RunnerNameSchema,
  SchedulerDecisionSchema,
  SchedulerDecisionStatusSchema,
  ScmAuthModeSchema,
  ScmMutationResultSchema,
  ScmMutationStatusSchema,
  ScmProviderSchema,
  ScmPullRequestDraftSchema,
  ScmPullRequestReviewCommentSchema,
  ScmPullRequestReviewDraftSchema,
  ScmRepositoryRefSchema,
  ScmTicketDraftSchema,
  StepAttemptSchema,
  StepAttemptStatusSchema,
  StepSchema,
  StepStatusSchema,
  SubPlanSchema,
  StepTypeSchema,
  TaskGraphSchema,
  UsagePrecisionSchema,
} from "./schemas";

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
export type ModelInvocationPhase = z.infer<typeof ModelInvocationPhaseSchema>;
export type ModelInvocationStatus = z.infer<typeof ModelInvocationStatusSchema>;
export type AccessMode = z.infer<typeof AccessModeSchema>;
export type UsagePrecision = z.infer<typeof UsagePrecisionSchema>;
export type ReviewVerdictValue = z.infer<typeof ReviewVerdictValueSchema>;
export type ReviewIssueSeverity = z.infer<typeof ReviewIssueSeveritySchema>;
export type ScmProvider = z.infer<typeof ScmProviderSchema>;
export type ScmAuthMode = z.infer<typeof ScmAuthModeSchema>;
export type ScmMutationStatus = z.infer<typeof ScmMutationStatusSchema>;
export type Step = z.infer<typeof StepSchema>;
export type SubPlan = z.infer<typeof SubPlanSchema>;
export type TaskGraph = z.infer<typeof TaskGraphSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunManifest = Run;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ModelUsage = z.infer<typeof ModelUsageSchema>;
export type ModelInvocationRecord = z.infer<typeof ModelInvocationRecordSchema>;
export type ModelUsageSummaryTotals = z.infer<typeof ModelUsageSummaryTotalsSchema>;
export type ModelUsageSummary = z.infer<typeof ModelUsageSummarySchema>;
export type StepAttempt = z.infer<typeof StepAttemptSchema>;
export type GateResult = z.infer<typeof GateResultSchema>;
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
export type ScmRepositoryRef = z.infer<typeof ScmRepositoryRefSchema>;
export type ScmTicketDraft = z.infer<typeof ScmTicketDraftSchema>;
export type ScmTicketDraftInput = z.input<typeof ScmTicketDraftSchema>;
export type ScmPullRequestDraft = z.infer<typeof ScmPullRequestDraftSchema>;
export type ScmPullRequestDraftInput = z.input<typeof ScmPullRequestDraftSchema>;
export type ScmPullRequestReviewComment = z.infer<typeof ScmPullRequestReviewCommentSchema>;
export type ScmPullRequestReviewDraft = z.infer<typeof ScmPullRequestReviewDraftSchema>;
export type ScmPullRequestReviewDraftInput = z.input<typeof ScmPullRequestReviewDraftSchema>;
export type ScmMutationResult = z.infer<typeof ScmMutationResultSchema>;
export type EvidenceSubject = z.infer<typeof EvidenceSubjectSchema>;
export type PrDraftArtifact = z.infer<typeof PrDraftArtifactSchema>;
export type ContextPackage = z.infer<typeof ContextPackageSchema>;
export type SchedulerDecision = z.infer<typeof SchedulerDecisionSchema>;
export type RunnerModelUsage = z.infer<typeof RunnerModelUsageSchema>;
export type RunnerExecutionError = z.infer<typeof RunnerExecutionErrorSchema>;
export type RunnerExecutionInput = z.infer<typeof RunnerExecutionInputSchema>;
export type RunnerExecutionOutput = z.infer<typeof RunnerExecutionOutputSchema>;
export type AttemptSummary = z.infer<typeof AttemptSummarySchema>;
export type FinalVerdict = z.infer<typeof FinalVerdictSchema>;
export type FinalCostReport = z.infer<typeof FinalCostReportSchema>;
export type BudgetProfileLimit = z.infer<typeof BudgetProfileLimitSchema>;
export type RunCompletionPhaseSummary = z.infer<typeof RunCompletionPhaseSummarySchema>;
export type RunCompletionSummary = z.infer<typeof RunCompletionSummarySchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type EvidenceFileHash = z.infer<typeof EvidenceFileHashSchema>;
export type RunAuditSnapshot = z.infer<typeof RunAuditSnapshotSchema>;
export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type A2AMessageMetadata = z.infer<typeof A2AMessageMetadataSchema>;
export type A2AAttachmentDescriptor = z.infer<typeof A2AAttachmentDescriptorSchema>;
export type ProtocolEnvelopeKind = z.infer<typeof ProtocolEnvelopeKindSchema>;
export type ProtocolEnvelope = z.infer<typeof ProtocolEnvelopeSchema>;
export type A2ARuntimeMode = z.infer<typeof A2ARuntimeModeSchema>;
export type A2ARuntimeDecisionStatus = z.infer<typeof A2ARuntimeDecisionStatusSchema>;
export type A2ARuntimeDecision = z.infer<typeof A2ARuntimeDecisionSchema>;
export type A2ATrustedPeer = z.infer<typeof A2ATrustedPeerSchema>;
export type A2AConfig = z.infer<typeof A2AConfigSchema>;
export type KiwiConfig = z.infer<typeof KiwiConfigSchema>;
export type PolicyRoutingOverride = z.infer<typeof PolicyRoutingOverrideSchema>;
export type ProviderPreference = z.infer<typeof ProviderPreferenceSchema>;
export type CommandProfile = z.infer<typeof CommandProfileSchema>;
export type ExecutionIsolation = z.infer<typeof ExecutionIsolationSchema>;
export type CodexSandbox = z.infer<typeof CodexSandboxSchema>;
export type ExecutionDefaults = z.infer<typeof ExecutionDefaultsSchema>;
export type KiwiPolicy = z.infer<typeof KiwiPolicySchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;
