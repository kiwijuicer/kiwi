import type {
  AccessMode,
  BudgetProfile,
  BudgetProfileLimit,
  ContextLevel,
  ContextPackage,
  ExecutionIsolation,
  ExecutionOwner,
  Initiative,
  KiwiPolicy,
  ModelCapability,
  RunnerName,
  SchedulerDecisionStatus,
  TaskGraph,
  Step,
} from "@kiwi/contracts";

export type { ContextLevel, SchedulerDecisionStatus } from "@kiwi/contracts";

export const BLAST_RADIUS_VALUES = ["low", "medium", "high"] as const;
export const SECURITY_SENSITIVITY_VALUES = ["low", "medium", "high"] as const;
export const CONTEXT_SIZE_VALUES = ["small", "medium", "large"] as const;

export const BlastRadii = {
  Low: "low",
  Medium: "medium",
  High: "high",
} as const;

export const SecuritySensitivities = {
  Low: "low",
  Medium: "medium",
  High: "high",
} as const;

export const ContextSizes = {
  Small: "small",
  Medium: "medium",
  Large: "large",
} as const;

export type BlastRadius = (typeof BLAST_RADIUS_VALUES)[number];
export type SecuritySensitivity = (typeof SECURITY_SENSITIVITY_VALUES)[number];
export type ContextSize = (typeof CONTEXT_SIZE_VALUES)[number];

export type { ContextPackage } from "@kiwi/contracts";

export interface SchedulerInput {
  cwd: string;
  runId: string;
  step: Step;
  initiative: Initiative;
  taskGraph?: TaskGraph;
  policy?: KiwiPolicy;
  budgetProfile: BudgetProfile;
  budgetRemainingUsdEstimate: number | null;
  blastRadius: BlastRadius;
  securitySensitivity: SecuritySensitivity;
  contextSize: ContextSize;
  runnerAvailability: RunnerName[];
  explicitCommand?: boolean;
  relevantFiles?: string[];
  testFiles?: string[];
  recentDiffFiles?: string[];
  symbolHits?: string[];
  traces?: string[];
  architectureFiles?: string[];
  historicalOutcomeRefs?: string[];
  now?: Date;
  attemptId?: string;
}

export interface SchedulerDecision {
  status: SchedulerDecisionStatus;
  runId: string;
  stepId: string;
  attemptId: string;
  blockedReason?: string;
  agentRole: Step["recommendedAgentRole"];
  modelCapability: ModelCapability;
  runner: RunnerName | null;
  contextLevel: ContextLevel;
  reviewDepth: ModelCapability;
  requiredGates: string[];
  routingReason: string[];
  selectedModelId?: string | null;
  selectedProviderModel?: string | null;
  selectedAccessMode?: AccessMode | null;
  executorSelectionReason?: string | null;
  estimatedAttemptCostUsd?: number;
  executionOwner?: ExecutionOwner;
  executionIsolation?: ExecutionIsolation;
  budget?: BudgetProfileLimit & {
    remainingUsdEstimate: number | null;
  };
  contextPackageRef: string;
}
