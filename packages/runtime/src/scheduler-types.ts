import { AccessMode, BudgetProfile, BudgetProfileLimit, Initiative, ModelCapability, RunnerName, Step } from "@kiwi/contracts";

export type ContextLevel = "L0" | "L1" | "L2" | "L3";
export type BlastRadius = "low" | "medium" | "high";
export type SecuritySensitivity = "low" | "medium" | "high";
export type ContextSize = "small" | "medium" | "large";
export type SchedulerDecisionStatus = "scheduled" | "blocked";

export interface ContextPackage {
  runId: string;
  stepId: string;
  attemptId: string;
  level: ContextLevel;
  include: {
    initiative: boolean;
    policy: boolean;
    registry: boolean;
    commands: boolean;
    relevantFiles: string[];
    tests: string[];
    recentDiffFiles: string[];
    symbolHits: string[];
    traces: string[];
    architectureFiles: string[];
    historicalOutcomeRefs: string[];
  };
  generatedAt: string;
}

export interface SchedulerInput {
  cwd: string;
  runId: string;
  step: Step;
  initiative: Initiative;
  budgetProfile: BudgetProfile;
  budgetRemainingUsdEstimate: number | null;
  blastRadius: BlastRadius;
  securitySensitivity: SecuritySensitivity;
  contextSize: ContextSize;
  runnerAvailability: RunnerName[];
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
  executionOwner?: "kiwi-codex-cli";
  executionIsolation?: "direct" | "worktree";
  budget?: BudgetProfileLimit & {
    remainingUsdEstimate: number | null;
  };
  contextPackageRef: string;
}
