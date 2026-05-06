import { existsSync, readFileSync } from "fs";
import {
  BudgetProfileLimit,
  ContractValues,
  ModelCapability,
  ModelCapabilitySchema,
  RunnerName,
  RunnerNameSchema,
  SchedulerDecisionSchema,
  Step,
  StepAttempt,
  StepAttemptSchema,
} from "@kiwi/contracts";
import {
  appendAuditEvent,
  budgetLimitForProfile,
  budgetSoftCapExceeded,
  ensureRunLayout,
  resolveRunArtifactPath,
  writeJsonSafely,
} from "@kiwi/core";
import type {
  BlastRadius,
  ContextLevel,
  ContextPackage,
  ContextSize,
  SchedulerDecision,
  SchedulerInput,
  SecuritySensitivity,
} from "./scheduler-types";
export type {
  BlastRadius,
  ContextLevel,
  ContextPackage,
  ContextSize,
  SchedulerDecision,
  SchedulerDecisionStatus,
  SchedulerInput,
  SecuritySensitivity,
} from "./scheduler-types";

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

export function loadSchedulerDecision(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
}): SchedulerDecision {
  const relative = `steps/${params.stepId}/${params.attemptId}/scheduler-decision.json`;
  const target = resolveRunArtifactPath(params.runId, relative, params.cwd);
  if (!existsSync(target)) {
    throw new Error(`scheduler decision not found: ${relative}`);
  }
  return SchedulerDecisionSchema.parse(JSON.parse(readFileSync(target, "utf-8"))) as SchedulerDecision;
}

const CAPABILITY_RANK: Record<ModelCapability, number> = {
  cheap: 0,
  mid: 1,
  strong: 2,
  frontier: 3,
};

function defaultAttemptId(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 17);
  return `attempt_${stamp}`;
}

function pickRunner(runners: RunnerName[]): RunnerName | null {
  const parsed = runners.map((entry) => RunnerNameSchema.parse(entry));
  return parsed[0] ?? null;
}

function maxCapability(a: ModelCapability, b: ModelCapability): ModelCapability {
  return CAPABILITY_RANK[a] >= CAPABILITY_RANK[b] ? a : b;
}

function downgradeCapability(capability: ModelCapability): ModelCapability {
  switch (capability) {
    case ContractValues.Frontier:
      return ContractValues.Strong;
    case ContractValues.Strong:
      return ContractValues.Mid;
    case ContractValues.Mid:
      return ContractValues.Cheap;
    case ContractValues.Cheap:
    default:
      return ContractValues.Cheap;
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
  const base: ContextLevel = params.contextSize === "small" ? "L0" : params.contextSize === "medium" ? "L1" : "L2";
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

function determineAgentRole(input: SchedulerInput, routingReason: string[]): Step["recommendedAgentRole"] {
  const riskHigh = determineRiskHigh(input);
  if (!riskHigh) return input.step.recommendedAgentRole;
  routingReason.push("risk_high_agent_role_escalation");
  if (isCodeExecutionStep(input.step) || input.step.type === "validation") return ContractValues.Security;
  if (input.step.type === "review") return ContractValues.Reviewer;
  return input.step.recommendedAgentRole;
}

function determineModelCapability(input: SchedulerInput, routingReason: string[]): ModelCapability {
  const riskHigh = determineRiskHigh(input);
  let capability = ModelCapabilitySchema.parse(input.step.recommendedModelCapability);

  const budgetConstrained =
    input.budgetProfile === "tiny" ||
    input.budgetProfile === "small" ||
    budgetSoftCapExceeded({
      budgetProfile: input.budgetProfile,
      remainingUsdEstimate: input.budgetRemainingUsdEstimate,
    });
  if (!riskHigh && budgetConstrained) {
    capability = downgradeCapability(capability);
    routingReason.push("budget_constrained_downgrade");
  }
  if (riskHigh) {
    capability = maxCapability(capability, ContractValues.Strong);
    routingReason.push("risk_over_budget_min_strong");
  }

  return capability;
}

function determineReviewDepth(
  input: SchedulerInput,
  capability: ModelCapability,
  routingReason: string[],
): ModelCapability {
  const riskHigh = determineRiskHigh(input);
  if (input.step.type === "review") {
    routingReason.push("review_step_frontier_review");
    return ContractValues.Frontier;
  }
  if (riskHigh) {
    routingReason.push("risk_high_frontier_review");
    return ContractValues.Frontier;
  }
  if (CAPABILITY_RANK[capability] >= CAPABILITY_RANK.strong) {
    routingReason.push("strong_capability_strong_review");
    return ContractValues.Strong;
  }
  return ContractValues.Mid;
}

function determineRequiredGates(input: SchedulerInput, routingReason: string[]): string[] {
  const riskHigh = determineRiskHigh(input);
  const gates = new Set(input.step.requiredGates);
  if (riskHigh) {
    gates.add("forbidden_file_checks");
    gates.add("secrets_check");
    routingReason.push("risk_high_security_gates");
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
    status: ContractValues.Pending,
    contextPackageRef: contextRef,
    artifacts: [],
    startedAt: params.now.toISOString(),
    completedAt: null,
  });

  writeJsonSafely(attemptTarget, attempt);
  writeJsonSafely(contextTarget, params.contextPackage);
  return { attemptRef, contextRef };
}

function saveSchedulerDecision(cwd: string, decision: SchedulerDecision): string {
  const relative = `steps/${decision.stepId}/${decision.attemptId}/scheduler-decision.json`;
  const target = resolveRunArtifactPath(decision.runId, relative, cwd);
  writeJsonSafely(target, SchedulerDecisionSchema.parse(decision));
  return relative;
}

interface PreparedScheduling {
  now: Date;
  attemptId: string;
  runner: RunnerName | null;
  routingReason: string[];
  budget: BudgetProfileLimit & { remainingUsdEstimate: number | null };
  riskHigh: boolean;
  agentRole: Step["recommendedAgentRole"];
  contextLevel: ContextLevel;
  modelCapability: ModelCapability;
  reviewDepth: ModelCapability;
  requiredGates: string[];
  contextPackage: ContextPackage;
}

function contextPackageRef(stepId: string, attemptId: string): string {
  return `steps/${stepId}/${attemptId}/context-package.json`;
}

function prepareScheduling(input: SchedulerInput): PreparedScheduling {
  const now = input.now ?? new Date();
  const attemptId = input.attemptId ?? defaultAttemptId(now);
  const runner = pickRunner(input.runnerAvailability);
  const routingReason: string[] = [];
  const budgetLimit = budgetLimitForProfile(input.budgetProfile);
  const budget = {
    ...budgetLimit,
    remainingUsdEstimate: input.budgetRemainingUsdEstimate,
  };
  if (input.budgetRemainingUsdEstimate === null) {
    routingReason.push("budget_remaining_unknown");
  }
  const agentRole = determineAgentRole(input, routingReason);
  const riskHigh = determineRiskHigh(input);
  const contextLevel = determineContextLevel({
    contextSize: input.contextSize,
    riskHigh,
    blastRadius: input.blastRadius,
    securitySensitivity: input.securitySensitivity,
  });
  const modelCapability = determineModelCapability(input, routingReason);
  const reviewDepth = determineReviewDepth(input, modelCapability, routingReason);
  const requiredGates = determineRequiredGates(input, routingReason);
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

  return {
    now,
    attemptId,
    runner,
    routingReason,
    budget,
    riskHigh,
    agentRole,
    contextLevel,
    modelCapability,
    reviewDepth,
    requiredGates,
    contextPackage,
  };
}

function blockScheduling(input: SchedulerInput, prepared: PreparedScheduling, reason: string): SchedulerDecision {
  prepared.routingReason.push(reason);
  const decision: SchedulerDecision = {
    status: ContractValues.Blocked,
    runId: input.runId,
    stepId: input.step.stepId,
    attemptId: prepared.attemptId,
    blockedReason: reason,
    agentRole: prepared.agentRole,
    modelCapability: prepared.modelCapability,
    runner: reason === "no_runner_available" ? null : prepared.runner,
    contextLevel: prepared.contextLevel,
    reviewDepth: prepared.reviewDepth,
    requiredGates: prepared.requiredGates,
    routingReason: prepared.routingReason,
    budget: prepared.budget,
    contextPackageRef: contextPackageRef(input.step.stepId, prepared.attemptId),
  };
  saveSchedulerDecision(input.cwd, decision);
  appendAuditEvent(input.cwd, {
    eventType: "scheduler_blocked",
    runId: input.runId,
    timestamp: prepared.now.toISOString(),
    payload: {
      stepId: input.step.stepId,
      reason,
      runnerAvailability: input.runnerAvailability,
      budgetProfile: input.budgetProfile,
      budgetRemainingUsdEstimate: input.budgetRemainingUsdEstimate,
      routingReason: prepared.routingReason,
    },
  });
  return decision;
}

function schedulePreparedAttempt(
  input: SchedulerInput,
  prepared: PreparedScheduling,
  runner: RunnerName,
): SchedulerDecision {
  prepared.routingReason.push(`runner_selected:${runner}`);
  const saved = saveAttemptAndContext({
    cwd: input.cwd,
    runId: input.runId,
    step: input.step,
    attemptId: prepared.attemptId,
    decision: {
      agentRole: prepared.agentRole,
      modelCapability: prepared.modelCapability,
      runner,
      contextLevel: prepared.contextLevel,
      reviewDepth: prepared.reviewDepth,
      requiredGates: prepared.requiredGates,
      routingReason: prepared.routingReason,
      budget: prepared.budget,
    },
    contextPackage: prepared.contextPackage,
    now: prepared.now,
  });
  const decision: SchedulerDecision = {
    status: "scheduled",
    runId: input.runId,
    stepId: input.step.stepId,
    attemptId: prepared.attemptId,
    agentRole: prepared.agentRole,
    modelCapability: prepared.modelCapability,
    runner,
    contextLevel: prepared.contextLevel,
    reviewDepth: prepared.reviewDepth,
    requiredGates: prepared.requiredGates,
    routingReason: prepared.routingReason,
    budget: prepared.budget,
    contextPackageRef: saved.contextRef,
  };
  saveSchedulerDecision(input.cwd, decision);
  return decision;
}

function auditScheduled(input: SchedulerInput, prepared: PreparedScheduling, decision: SchedulerDecision): void {
  appendAuditEvent(input.cwd, {
    eventType: "scheduler_routing_decided",
    runId: input.runId,
    timestamp: prepared.now.toISOString(),
    payload: {
      stepId: input.step.stepId,
      attemptId: prepared.attemptId,
      agentRole: input.step.recommendedAgentRole,
      selectedAgentRole: prepared.agentRole,
      modelCapability: prepared.modelCapability,
      runner: decision.runner,
      contextLevel: prepared.contextLevel,
      reviewDepth: prepared.reviewDepth,
      requiredGates: prepared.requiredGates,
      budgetProfile: input.budgetProfile,
      budgetRemainingUsdEstimate: input.budgetRemainingUsdEstimate,
      riskProfile: input.initiative.riskProfile,
      blastRadius: input.blastRadius,
      securitySensitivity: input.securitySensitivity,
      routingReason: prepared.routingReason,
    },
  });
  appendAuditEvent(input.cwd, {
    eventType: "context_package_created",
    runId: input.runId,
    timestamp: prepared.now.toISOString(),
    payload: {
      stepId: input.step.stepId,
      attemptId: prepared.attemptId,
      contextLevel: prepared.contextLevel,
      contextPackageRef: decision.contextPackageRef,
      relevantFiles: prepared.contextPackage.include.relevantFiles.length,
      symbolHits: prepared.contextPackage.include.symbolHits.length,
    },
  });
}

export function scheduleStepAttempt(input: SchedulerInput): SchedulerDecision {
  const prepared = prepareScheduling(input);

  if (!prepared.riskHigh && input.budgetRemainingUsdEstimate !== null && input.budgetRemainingUsdEstimate <= 0) {
    return blockScheduling(input, prepared, "budget_hard_cap_exhausted");
  }

  if (prepared.riskHigh && input.budgetRemainingUsdEstimate !== null && input.budgetRemainingUsdEstimate <= 0) {
    prepared.routingReason.push("risk_over_budget_hard_cap_override");
  }

  if (!prepared.runner) return blockScheduling(input, prepared, "no_runner_available");

  const decision = schedulePreparedAttempt(input, prepared, prepared.runner);
  auditScheduled(input, prepared, decision);
  return decision;
}
