import {
  ContractValues,
  GateResult,
  GateResultSchema,
  GateTypes,
  NextActionTypes,
  ReviewVerdictSchema,
  SchedulerDecisionSchema,
} from "@kiwi/contracts";
import {
  appendAuditEvent,
  assertWithinBudgetEstimate,
  BudgetExceededError,
  estimateAttemptCostUsd,
  resolveRunArtifactPath,
  writeJsonSafely,
} from "@kiwi/core";
import { saveReviewVerdict } from "../../review/review-engine.js";
import { saveRunnerCostReport, loadStepAttempt } from "../step-attempt-artifacts.js";
import { auditAttemptFinished } from "./audit.js";
import { persistAttemptCompletion } from "./persistence.js";
import type { StepAttemptOrchestrationResult } from "./result.js";
import type {
  ExecuteStepAttemptInput,
  StepAttemptNextAction,
  StepRunnerExecutionError,
  StepRunnerExecutionOutput,
} from "../step-runner-types.js";

interface AttemptScope {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
}

interface BudgetBlockedAttemptParams<TCommandPolicy> {
  input: ExecuteStepAttemptInput<TCommandPolicy>;
  runId: string;
  stepId: string;
  attemptId: string;
  attemptScope: AttemptScope;
  now: Date;
}

interface BudgetGateArtifacts {
  gateResultsRef: string;
  budgetGateResult: GateResult;
  gateResults: GateResult[];
}

const BUDGET_BLOCKED_REASON = "budget_estimate_exceeds_remaining";
const BUDGET_EXCEEDED_CODE = "BUDGET_EXCEEDED";
const BUDGET_PROVIDER_NAME = "budget-preflight";

function budgetPreflightError<TCommandPolicy>(
  params: BudgetBlockedAttemptParams<TCommandPolicy>,
): BudgetExceededError | null {
  const budget = params.input.schedulerDecision.budget;

  if (!budget) {
    return null;
  }
  if (params.input.schedulerDecision.routingReason.includes("risk_over_budget_hard_cap_override")) {
    return null;
  }
  if (!params.input.selectedModel) {
    return null;
  }
  const estimateAttemptCostUsdValue = estimateAttemptCostUsd({
    model: params.input.selectedModel,
    capability: params.input.schedulerDecision.modelCapability,
    contextLevel: params.input.schedulerDecision.contextLevel,
  });

  try {
    assertWithinBudgetEstimate({
      budgetProfile: budget.profile,
      remainingUsdEstimate: budget.remainingUsdEstimate,
      model: params.input.selectedModel,
      modelCapability: params.input.schedulerDecision.modelCapability,
      contextLevel: params.input.schedulerDecision.contextLevel,
      estimateAttemptCostUsdValue,
    });

    return null;
  } catch (error) {
    if (!(error instanceof BudgetExceededError)) {
      throw error;
    }

    return error;
  }
}

const budgetBlockOutcome = {
  routingReasonWithBudgetBlock(routingReason: string[]): string[] {
    return routingReason.includes(BUDGET_BLOCKED_REASON) ? routingReason : [...routingReason, BUDGET_BLOCKED_REASON];
  },
  nextAction(): StepAttemptNextAction {
    return {
      type: NextActionTypes.Replan,
      reason: BUDGET_BLOCKED_REASON,
      recommendedNextSteps: ["Increase budget profile or re-run with lower capability/context requirements."],
      issueCodes: [BUDGET_EXCEEDED_CODE],
    };
  },
};

function writeBlockedSchedulerDecision<TCommandPolicy>(
  params: BudgetBlockedAttemptParams<TCommandPolicy>,
  routingReason: string[],
): void {
  const blockedDecision = SchedulerDecisionSchema.parse({
    ...params.input.schedulerDecision,
    status: ContractValues.Blocked,
    blockedReason: BUDGET_BLOCKED_REASON,
    routingReason,
  });

  writeJsonSafely(
    resolveRunArtifactPath(
      params.runId,
      `steps/${params.stepId}/${params.attemptId}/scheduler-decision.json`,
      params.input.cwd,
    ),
    blockedDecision,
  );
}

function writeBudgetGateResults<TCommandPolicy>(
  params: BudgetBlockedAttemptParams<TCommandPolicy>,
): BudgetGateArtifacts {
  const gateResultsRef = `steps/${params.stepId}/${params.attemptId}/gate-results.json`;
  const budgetGateResult = GateResultSchema.parse({
    gateId: "gate_budget_preflight",
    gateType: GateTypes.ForbiddenFileChecks,
    status: ContractValues.Blocked,
    evidenceRefs: [`steps/${params.stepId}/${params.attemptId}/scheduler-decision.json`],
    reason: BUDGET_BLOCKED_REASON,
  });
  const gateResults: GateResult[] = [budgetGateResult];

  writeJsonSafely(resolveRunArtifactPath(params.runId, gateResultsRef, params.input.cwd), gateResults);

  return { gateResultsRef, budgetGateResult, gateResults };
}

function writeBudgetReview<TCommandPolicy>(
  params: BudgetBlockedAttemptParams<TCommandPolicy>,
  error: BudgetExceededError,
): { reviewVerdict: ReturnType<typeof ReviewVerdictSchema.parse>; reviewReportRef: string } {
  const reviewVerdict = ReviewVerdictSchema.parse({
    verdict: ContractValues.Reject,
    safeToContinue: false,
    issues: [
      {
        code: BUDGET_EXCEEDED_CODE,
        title: "Pre-flight budget guard blocked the attempt",
        severity: "high",
        detail: error.message,
      },
    ],
    recommendedNextSteps: ["Increase --budget-profile or reduce model/context demand for this step."],
    confidence: 0.95,
  });
  const reviewReportRef = saveReviewVerdict({
    cwd: params.input.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    verdict: reviewVerdict,
  });

  return { reviewVerdict, reviewReportRef };
}

function writeBudgetCostReport<TCommandPolicy>(
  params: BudgetBlockedAttemptParams<TCommandPolicy>,
  completedAt: string,
): string {
  return saveRunnerCostReport({
    cwd: params.input.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    runner: params.input.runner.name,
    modelId: params.input.selectedModelId ?? null,
    providerName: BUDGET_PROVIDER_NAME,
    agentRole: params.input.schedulerDecision.agentRole,
    modelCapability: params.input.schedulerDecision.modelCapability,
    reviewDepth: params.input.schedulerDecision.reviewDepth,
    modelInvocationRefs: [],
    modelUsage: { inputTokens: 0, outputTokens: 0 },
    usagePrecision: "unknown",
    estimatedCostUsd: 0,
    createdAt: completedAt,
  });
}

function budgetRunnerOutput<TCommandPolicy>(
  params: BudgetBlockedAttemptParams<TCommandPolicy>,
  budgetGateResult: GateResult,
  error: BudgetExceededError,
): { blockedError: StepRunnerExecutionError; runnerOutput: StepRunnerExecutionOutput } {
  const blockedError: StepRunnerExecutionError = {
    code: BUDGET_EXCEEDED_CODE,
    message: error.message,
  };
  const runnerOutput: StepRunnerExecutionOutput = {
    status: ContractValues.Blocked,
    artifactRefs: [],
    rawLogsRef: null,
    modelUsage: { inputTokens: 0, outputTokens: 0 },
    modelId: params.input.selectedModelId ?? null,
    providerName: BUDGET_PROVIDER_NAME,
    usagePrecision: "unknown",
    estimatedCostUsd: 0,
    gateResult: budgetGateResult,
    error: blockedError,
  };

  return { blockedError, runnerOutput };
}

function auditBudgetBlocked<TCommandPolicy>(params: {
  attempt: BudgetBlockedAttemptParams<TCommandPolicy>;
  error: BudgetExceededError;
  routingReason: string[];
  completedAt: string;
  runnerOutput: StepRunnerExecutionOutput;
  reviewVerdict: ReturnType<typeof ReviewVerdictSchema.parse>;
  reviewReportRef: string;
  gateResultsRef: string;
  nextAction: StepAttemptNextAction;
}): void {
  appendAuditEvent(params.attempt.input.cwd, {
    eventType: "scheduler_blocked",
    runId: params.attempt.runId,
    timestamp: params.completedAt,
    payload: {
      stepId: params.attempt.stepId,
      attemptId: params.attempt.attemptId,
      reason: BUDGET_BLOCKED_REASON,
      budgetProfile: params.error.context.budgetProfile,
      remainingUsdEstimate: params.error.context.remainingUsdEstimate,
      estimatedAttemptCostUsd: params.error.context.estimatedAttemptCostUsd,
      modelId: params.error.context.modelId,
      modelCapability: params.error.context.modelCapability,
      contextLevel: params.error.context.contextLevel,
      routingReason: params.routingReason,
    },
  });
  auditAttemptFinished({
    ...params.attempt.attemptScope,
    runner: params.attempt.input.runner.name,
    runnerOutput: params.runnerOutput,
    reviewVerdict: params.reviewVerdict,
    reviewReportRef: params.reviewReportRef,
    gateResultsRef: params.gateResultsRef,
    nextAction: params.nextAction,
    status: ContractValues.Blocked,
    completedAt: params.completedAt,
  });
}

export function writeBudgetBlockedAttempt<TCommandPolicy>(
  params: BudgetBlockedAttemptParams<TCommandPolicy>,
): StepAttemptOrchestrationResult | null {
  const budgetError = budgetPreflightError(params);

  if (!budgetError) {
    return null;
  }

  const routingReason = budgetBlockOutcome.routingReasonWithBudgetBlock(params.input.schedulerDecision.routingReason);
  writeBlockedSchedulerDecision(params, routingReason);

  const completedAt = params.now.toISOString();
  const { gateResultsRef, budgetGateResult, gateResults } = writeBudgetGateResults(params);
  const { reviewVerdict, reviewReportRef } = writeBudgetReview(params, budgetError);
  const costReportRef = writeBudgetCostReport(params, completedAt);
  const { blockedError, runnerOutput } = budgetRunnerOutput(params, budgetGateResult, budgetError);
  const nextAction = budgetBlockOutcome.nextAction();
  const persistedAttempt = persistAttemptCompletion({
    ...params.attemptScope,
    existingAttempt: loadStepAttempt(params.attemptScope),
    status: ContractValues.Blocked,
    runnerOutput,
    additionalArtifacts: [],
    postRunnerArtifacts: [],
    reviewReportRef,
    costReportRef,
    gateResultsRef,
    modelInvocationRefs: [],
    nextAction,
    completedAt,
  });

  auditBudgetBlocked({
    attempt: params,
    error: budgetError,
    routingReason,
    completedAt,
    runnerOutput,
    reviewVerdict,
    reviewReportRef,
    gateResultsRef,
    nextAction,
  });

  return {
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    status: ContractValues.Blocked,
    runnerStatus: ContractValues.Blocked,
    artifactRefs: persistedAttempt.artifacts,
    gateResults,
    gateResultsRef,
    reviewVerdict,
    reviewReportRef,
    attemptRef: persistedAttempt.attemptRef,
    nextAction,
    error: blockedError,
  };
}
