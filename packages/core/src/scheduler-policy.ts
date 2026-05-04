import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import {
  BudgetProfile,
  Initiative,
  ModelCapability,
  ModelCapabilitySchema,
  RunnerName,
  RunnerNameSchema,
  Step,
  StepAttempt,
  StepAttemptSchema,
} from "@ai-kiwi/contracts";
import { appendAuditEvent } from "./cost-ledger";
import { ensureRunLayout, resolveRunArtifactPath } from "./run-store";

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
  contextPackageRef: string;
}

export function loadContextPackage(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
}): ContextPackage {
  const relative = `steps/${params.stepId}/${params.attemptId}/context-package.json`;
  const target = resolveRunArtifactPath(params.runId, relative, params.cwd);
  if (!existsSync(target)) {
    throw new Error(`context package not found: ${relative}`);
  }
  return JSON.parse(readFileSync(target, "utf-8")) as ContextPackage;
}

const CAPABILITY_RANK: Record<ModelCapability, number> = {
  cheap: 0,
  mid: 1,
  strong: 2,
  frontier: 3,
};

function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

function defaultAttemptId(now: Date): string {
  const stamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 17);
  return `attempt_${stamp}`;
}

function pickRunner(runners: RunnerName[]): RunnerName | null {
  const parsed = runners.map((entry) => RunnerNameSchema.parse(entry));
  const priority: RunnerName[] = ["local-shell", "api", "codex", "claude-code"];
  for (const candidate of priority) {
    if (parsed.includes(candidate)) return candidate;
  }
  return null;
}

function maxCapability(a: ModelCapability, b: ModelCapability): ModelCapability {
  return CAPABILITY_RANK[a] >= CAPABILITY_RANK[b] ? a : b;
}

function downgradeCapability(capability: ModelCapability): ModelCapability {
  switch (capability) {
    case "frontier":
      return "strong";
    case "strong":
      return "mid";
    case "mid":
      return "cheap";
    case "cheap":
    default:
      return "cheap";
  }
}

function sanitizeList(entries: string[], limit: number): string[] {
  return entries
    .filter((entry) => entry.trim().length > 0)
    .filter((entry) => !entry.includes("*"))
    .slice(0, limit);
}

function determineContextLevel(params: {
  contextSize: ContextSize;
  riskHigh: boolean;
  blastRadius: BlastRadius;
  securitySensitivity: SecuritySensitivity;
}): ContextLevel {
  const base: ContextLevel =
    params.contextSize === "small" ? "L0" : params.contextSize === "medium" ? "L1" : "L2";
  if (!params.riskHigh) return base;
  if (params.blastRadius === "high" && params.securitySensitivity === "high") return "L3";
  return base === "L0" ? "L2" : base;
}

function buildContextPackage(params: {
  runId: string;
  stepId: string;
  attemptId: string;
  level: ContextLevel;
  now: Date;
  relevantFiles: string[];
  testFiles: string[];
  recentDiffFiles: string[];
  symbolHits: string[];
  traces: string[];
  architectureFiles: string[];
  historicalOutcomeRefs: string[];
}): ContextPackage {
  const levelLimits: Record<ContextLevel, number> = { L0: 4, L1: 12, L2: 25, L3: 40 };
  const limit = levelLimits[params.level];

  return {
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    level: params.level,
    include: {
      initiative: true,
      policy: true,
      registry: true,
      commands: true,
      relevantFiles: sanitizeList(params.relevantFiles, limit),
      tests: sanitizeList(params.testFiles, Math.max(4, Math.floor(limit / 2))),
      recentDiffFiles: sanitizeList(params.recentDiffFiles, Math.max(4, Math.floor(limit / 2))),
      symbolHits: sanitizeList(params.symbolHits, limit),
      traces: sanitizeList(params.traces, Math.max(2, Math.floor(limit / 3))),
      architectureFiles: sanitizeList(params.architectureFiles, Math.max(4, Math.floor(limit / 2))),
      historicalOutcomeRefs: sanitizeList(params.historicalOutcomeRefs, Math.max(2, Math.floor(limit / 3))),
    },
    generatedAt: params.now.toISOString(),
  };
}

function determineRiskHigh(input: SchedulerInput): boolean {
  return (
    input.initiative.riskProfile === "production" ||
    input.securitySensitivity === "high" ||
    input.blastRadius === "high"
  );
}

function isCodeExecutionStep(step: Step): boolean {
  return ["coding", "code_creation", "code_modification", "refactoring"].includes(step.type);
}

function determineAgentRole(input: SchedulerInput): Step["recommendedAgentRole"] {
  const riskHigh = determineRiskHigh(input);
  if (!riskHigh) return input.step.recommendedAgentRole;
  if (isCodeExecutionStep(input.step) || input.step.type === "validation") return "security";
  if (input.step.type === "review") return "reviewer";
  return input.step.recommendedAgentRole;
}

function determineModelCapability(input: SchedulerInput): ModelCapability {
  const riskHigh = determineRiskHigh(input);
  let capability = ModelCapabilitySchema.parse(input.step.recommendedModelCapability);

  if (!riskHigh && (input.budgetProfile === "tiny" || input.budgetProfile === "small")) {
    capability = downgradeCapability(capability);
  }
  if (riskHigh) {
    capability = maxCapability(capability, "strong");
  }

  return capability;
}

function determineReviewDepth(input: SchedulerInput, capability: ModelCapability): ModelCapability {
  const riskHigh = determineRiskHigh(input);
  if (input.step.type === "review") return "frontier";
  if (riskHigh) return "frontier";
  if (CAPABILITY_RANK[capability] >= CAPABILITY_RANK.strong) return "strong";
  return "mid";
}

function determineRequiredGates(input: SchedulerInput): string[] {
  const riskHigh = determineRiskHigh(input);
  const gates = new Set(input.step.requiredGates);
  if (riskHigh) {
    gates.add("forbidden_file_checks");
    gates.add("secrets_check");
  }
  return Array.from(gates);
}

function saveAttemptAndContext(params: {
  cwd: string;
  runId: string;
  step: Step;
  attemptId: string;
  decision: Omit<SchedulerDecision, "status" | "runId" | "stepId" | "attemptId" | "contextPackageRef">;
  contextPackage: ContextPackage;
  now: Date;
}): { attemptRef: string; contextRef: string } {
  ensureRunLayout(params.runId, params.cwd);
  const attemptRef = `steps/${params.step.stepId}/${params.attemptId}/attempt.json`;
  const contextRef = `steps/${params.step.stepId}/${params.attemptId}/context-package.json`;
  const attemptTarget = resolveRunArtifactPath(params.runId, attemptRef, params.cwd);
  const contextTarget = resolveRunArtifactPath(params.runId, contextRef, params.cwd);

  const attempt: StepAttempt = StepAttemptSchema.parse({
    attemptId: params.attemptId,
    stepId: params.step.stepId,
    runner: params.decision.runner ?? "api",
    agentRole: params.decision.agentRole,
    modelCapability: params.decision.modelCapability,
    status: "pending",
    contextPackageRef: contextRef,
    artifacts: [],
    startedAt: params.now.toISOString(),
    completedAt: null,
  });

  writeJsonSafely(attemptTarget, attempt);
  writeJsonSafely(contextTarget, params.contextPackage);
  return { attemptRef, contextRef };
}

export function scheduleStepAttempt(input: SchedulerInput): SchedulerDecision {
  const now = input.now ?? new Date();
  const attemptId = input.attemptId ?? defaultAttemptId(now);
  const runner = pickRunner(input.runnerAvailability);
  const agentRole = determineAgentRole(input);
  const riskHigh = determineRiskHigh(input);
  const contextLevel = determineContextLevel({
    contextSize: input.contextSize,
    riskHigh,
    blastRadius: input.blastRadius,
    securitySensitivity: input.securitySensitivity,
  });
  const modelCapability = determineModelCapability(input);
  const reviewDepth = determineReviewDepth(input, modelCapability);
  const requiredGates = determineRequiredGates(input);
  const contextPackage = buildContextPackage({
    runId: input.runId,
    stepId: input.step.stepId,
    attemptId,
    level: contextLevel,
    now,
    relevantFiles: input.relevantFiles ?? [],
    testFiles: input.testFiles ?? [],
    recentDiffFiles: input.recentDiffFiles ?? [],
    symbolHits: input.symbolHits ?? [],
    traces: input.traces ?? [],
    architectureFiles: input.architectureFiles ?? [],
    historicalOutcomeRefs: input.historicalOutcomeRefs ?? [],
  });

  if (!runner) {
    appendAuditEvent(input.cwd, {
      eventType: "scheduler_blocked",
      runId: input.runId,
      timestamp: now.toISOString(),
      payload: {
        stepId: input.step.stepId,
        reason: "no_runner_available",
        runnerAvailability: input.runnerAvailability,
      },
    });
    return {
      status: "blocked",
      runId: input.runId,
      stepId: input.step.stepId,
      attemptId,
      blockedReason: "no_runner_available",
      agentRole,
      modelCapability,
      runner: null,
      contextLevel,
      reviewDepth,
      requiredGates,
      contextPackageRef: `steps/${input.step.stepId}/${attemptId}/context-package.json`,
    };
  }

  const saved = saveAttemptAndContext({
    cwd: input.cwd,
    runId: input.runId,
    step: input.step,
    attemptId,
    decision: {
      agentRole,
      modelCapability,
      runner,
      contextLevel,
      reviewDepth,
      requiredGates,
    },
    contextPackage,
    now,
  });

  appendAuditEvent(input.cwd, {
    eventType: "scheduler_routing_decided",
    runId: input.runId,
    timestamp: now.toISOString(),
    payload: {
      stepId: input.step.stepId,
      attemptId,
      agentRole: input.step.recommendedAgentRole,
      selectedAgentRole: agentRole,
      modelCapability,
      runner,
      contextLevel,
      reviewDepth,
      requiredGates,
      budgetProfile: input.budgetProfile,
      budgetRemainingUsdEstimate: input.budgetRemainingUsdEstimate,
      riskProfile: input.initiative.riskProfile,
      blastRadius: input.blastRadius,
      securitySensitivity: input.securitySensitivity,
    },
  });
  appendAuditEvent(input.cwd, {
    eventType: "context_package_created",
    runId: input.runId,
    timestamp: now.toISOString(),
    payload: {
      stepId: input.step.stepId,
      attemptId,
      contextLevel,
      contextPackageRef: saved.contextRef,
      relevantFiles: contextPackage.include.relevantFiles.length,
      symbolHits: contextPackage.include.symbolHits.length,
    },
  });

  return {
    status: "scheduled",
    runId: input.runId,
    stepId: input.step.stepId,
    attemptId,
    agentRole,
    modelCapability,
    runner,
    contextLevel,
    reviewDepth,
    requiredGates,
    contextPackageRef: saved.contextRef,
  };
}
