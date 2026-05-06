import {
  BudgetProfile,
  ContractValues,
  Initiative,
  InitiativeSource,
  KiwiPolicy,
  ModelEntry,
  ModelUsage,
  RiskProfile,
  TaskGraph,
} from "@kiwi/contracts";
import { remainingBudgetAfterEstimatedCost } from "./budget-policy";
import { appendAuditEvent, writePlannerCostReport } from "./cost-ledger";
import { generateRunId } from "./ids";
import { appendModelInvocation } from "./model-invocations";
import { createInitiativeFromInput } from "./planner";
import { savePlannedRun } from "./run-store";

export interface PlannerRunInput {
  runId: string;
  initiative: Initiative;
  policy: KiwiPolicy;
  requestedAt: string;
}

export interface PlannerCostEstimate {
  estimatedUsd: number;
  currency: "USD";
}

export interface PlannerRetryRecord {
  attempt: number;
  providerName: string;
  status: "valid" | "invalid";
  validationError?: string;
  modelUsage: ModelUsage;
  cost: PlannerCostEstimate;
}

export interface PlannerRetrySummary {
  maxAttempts: number;
  attemptsUsed: number;
  invalidAttempts: number;
  records: PlannerRetryRecord[];
}

export interface PlannerRunOutput {
  providerName: string;
  taskGraph: TaskGraph;
  modelUsage: ModelUsage;
  cost: PlannerCostEstimate;
  retry: PlannerRetrySummary;
  providerArtifacts?: {
    plannerInput?: unknown;
    plannerOutput?: unknown;
  };
}

export interface PlannerValidationFailureEvidence {
  providerName: string;
  maxAttempts: number;
  attemptsUsed: number;
  records: PlannerRetryRecord[];
  lastValidationError?: string;
}

export interface PlannerBudgetMetadata {
  profile: BudgetProfile;
  remainingUsdEstimate: number | null;
}

export interface PlanRunResult {
  runId: string;
  initiative: Initiative;
  taskGraph: TaskGraph;
  plannerInput: PlannerRunInput;
  plannerOutput: PlannerRunOutput & {
    plannerModelId: string;
    modelInvocationRef?: string;
    budget: PlannerBudgetMetadata;
  };
  plannerModelId: string;
  providerName: string;
  budgetMetadata: PlannerBudgetMetadata;
  modelInvocationRef?: string;
  workspacePath: string;
  repoId: string;
  repoPath: string;
}

export interface PlanRunParams {
  workspacePath: string;
  repoId: string;
  repoPath: string;
  rawInput: string;
  source: InitiativeSource;
  policy: KiwiPolicy;
  plannerModel: ModelEntry;
  executePlanner: (input: PlannerRunInput, options: { maxAttempts: number }) => Promise<PlannerRunOutput>;
  riskProfile?: RiskProfile;
  budgetProfile?: BudgetProfile;
  now?: Date;
  runId?: string;
  runIdSuffix?: string;
  initiativeIdSuffix?: string;
  maxAttempts?: number;
  persistRunArtifacts?: boolean;
}

export function selectPlannerModel(models: ModelEntry[]): ModelEntry {
  const candidate =
    models.find(
      (model) =>
        model.enabled && model.roles.includes(ContractValues.Planner) && model.capability === ContractValues.Frontier,
    ) ?? models.find((model) => model.enabled && model.roles.includes(ContractValues.Planner));

  if (!candidate) {
    throw new Error("No enabled planner model found in .kiwi/model-registry.yaml");
  }

  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlannerValidationFailureEvidence(value: unknown): value is PlannerValidationFailureEvidence {
  if (!isRecord(value)) return false;
  return (
    typeof value.providerName === "string" &&
    typeof value.maxAttempts === "number" &&
    typeof value.attemptsUsed === "number" &&
    Array.isArray(value.records)
  );
}

function plannerValidationFailureEvidence(error: unknown): PlannerValidationFailureEvidence | null {
  if (!isRecord(error)) return null;
  return isPlannerValidationFailureEvidence(error.evidence) ? error.evidence : null;
}

function appendPlannerFailureInvocation(params: {
  workspacePath: string;
  runId: string;
  plannerModel: ModelEntry;
  providerName: string;
  now: Date;
}): void {
  appendModelInvocation(params.workspacePath, {
    schemaVersion: "1",
    runId: params.runId,
    phase: ContractValues.Planner,
    agentRole: ContractValues.Planner,
    requestedCapability: params.plannerModel.capability,
    selectedCapability: params.plannerModel.capability,
    modelId: params.plannerModel.id,
    providerName: params.providerName,
    runner: null,
    accessMode: params.plannerModel.accessMode,
    usage: { inputTokens: 0, outputTokens: 0 },
    usagePrecision: "unknown",
    estimatedCostUsd: 0,
    status: ContractValues.Failed,
    evidenceRefs: [],
    startedAt: params.now.toISOString(),
    completedAt: params.now.toISOString(),
  });
}

function appendPlannerRetryEvents(params: {
  workspacePath: string;
  runId: string;
  now: Date;
  records: PlannerRetryRecord[];
}): void {
  for (const record of params.records) {
    if (record.status !== "invalid") continue;
    appendAuditEvent(params.workspacePath, {
      eventType: "planner_retry",
      runId: params.runId,
      timestamp: params.now.toISOString(),
      payload: {
        attempt: record.attempt,
        providerName: record.providerName,
        validationError: record.validationError ?? "unknown validation error",
      },
    });
  }
}

function handlePlannerExecutionFailure(params: {
  workspacePath: string;
  runId: string;
  plannerModel: ModelEntry;
  now: Date;
  error: unknown;
}): void {
  const evidence = plannerValidationFailureEvidence(params.error);
  if (evidence) {
    appendPlannerRetryEvents({
      workspacePath: params.workspacePath,
      runId: params.runId,
      now: params.now,
      records: evidence.records,
    });
    appendAuditEvent(params.workspacePath, {
      eventType: "planner_validation_failed",
      runId: params.runId,
      timestamp: params.now.toISOString(),
      payload: {
        providerName: evidence.providerName,
        attemptsUsed: evidence.attemptsUsed,
        maxAttempts: evidence.maxAttempts,
        lastValidationError: evidence.lastValidationError ?? "unknown",
      },
    });
    appendAuditEvent(params.workspacePath, {
      eventType: "planner_failed",
      runId: params.runId,
      timestamp: params.now.toISOString(),
      payload: { reason: "planner_validation_failed" },
    });
    appendPlannerFailureInvocation({
      workspacePath: params.workspacePath,
      runId: params.runId,
      plannerModel: params.plannerModel,
      providerName: evidence.providerName,
      now: params.now,
    });
    return;
  }

  appendAuditEvent(params.workspacePath, {
    eventType: "planner_failed",
    runId: params.runId,
    timestamp: params.now.toISOString(),
    payload: {
      reason: params.error instanceof Error ? params.error.message : String(params.error),
    },
  });
  appendPlannerFailureInvocation({
    workspacePath: params.workspacePath,
    runId: params.runId,
    plannerModel: params.plannerModel,
    providerName: params.plannerModel.provider,
    now: params.now,
  });
}

function appendPlannerSuccessEvent(params: {
  workspacePath: string;
  runId: string;
  now: Date;
  plannerOutput: PlannerRunOutput;
  budgetMetadata: PlannerBudgetMetadata;
}): void {
  appendAuditEvent(params.workspacePath, {
    eventType: "planner_succeeded",
    runId: params.runId,
    timestamp: params.now.toISOString(),
    payload: {
      providerName: params.plannerOutput.providerName,
      attemptsUsed: params.plannerOutput.retry.attemptsUsed,
      invalidAttempts: params.plannerOutput.retry.invalidAttempts,
      modelUsage: params.plannerOutput.modelUsage,
      cost: params.plannerOutput.cost,
      budget: params.budgetMetadata,
    },
  });
}

function persistPlannerRunArtifacts(params: {
  planParams: PlanRunParams;
  runId: string;
  initiative: Initiative;
  plannerInput: PlannerRunInput;
  plannerOutput: PlannerRunOutput;
  budgetMetadata: PlannerBudgetMetadata;
  now: Date;
}): string {
  const { providerArtifacts, ...plannerOutputCore } = params.plannerOutput;
  const plannerInputArtifact = providerArtifacts?.plannerInput ?? params.plannerInput;
  const modelInvocationRef = appendModelInvocation(params.planParams.workspacePath, {
    schemaVersion: "1",
    runId: params.runId,
    phase: ContractValues.Planner,
    agentRole: ContractValues.Planner,
    requestedCapability: params.planParams.plannerModel.capability,
    selectedCapability: params.planParams.plannerModel.capability,
    modelId: params.planParams.plannerModel.id,
    providerName: params.plannerOutput.providerName,
    runner: null,
    accessMode: params.planParams.plannerModel.accessMode,
    usage: params.plannerOutput.modelUsage,
    usagePrecision: "estimated",
    estimatedCostUsd: params.plannerOutput.cost.estimatedUsd,
    status: ContractValues.Completed,
    evidenceRefs: ["plan/planner-input.json", "plan/planner-output.json", "plan/cost-report.json"],
    startedAt: params.now.toISOString(),
    completedAt: params.now.toISOString(),
  });

  savePlannedRun({
    runId: params.runId,
    initiative: params.initiative,
    taskGraph: params.plannerOutput.taskGraph,
    plannerInput: plannerInputArtifact,
    plannerOutput: {
      plannerModelId: params.planParams.plannerModel.id,
      modelInvocationRef,
      budget: params.budgetMetadata,
      ...plannerOutputCore,
      ...(providerArtifacts?.plannerOutput ? { provider: providerArtifacts.plannerOutput } : {}),
    },
    cwd: params.planParams.workspacePath,
    workspacePath: params.planParams.workspacePath,
    repoId: params.planParams.repoId,
    repoPath: params.planParams.repoPath,
    now: params.now,
  });
  writePlannerCostReport(params.planParams.workspacePath, params.runId, {
    schemaVersion: "1",
    runId: params.runId,
    plannerModelId: params.planParams.plannerModel.id,
    providerName: params.plannerOutput.providerName,
    budgetProfile: params.initiative.budgetProfile,
    budgetRemainingUsdEstimate: params.budgetMetadata.remainingUsdEstimate,
    attemptsUsed: params.plannerOutput.retry.attemptsUsed,
    invalidAttempts: params.plannerOutput.retry.invalidAttempts,
    modelUsage: params.plannerOutput.modelUsage,
    cost: params.plannerOutput.cost,
    createdAt: params.now.toISOString(),
  });

  return modelInvocationRef;
}

export async function planRun(params: PlanRunParams): Promise<PlanRunResult> {
  const now = params.now ?? new Date();
  const runIdOptions = params.runIdSuffix ? { suffix: params.runIdSuffix } : {};
  const runId = params.runId ?? generateRunId(now, runIdOptions);
  const initiativeParams = params.initiativeIdSuffix
    ? {
        rawInput: params.rawInput,
        repoPath: params.repoPath,
        source: params.source,
        riskProfile: params.riskProfile ?? "dev",
        budgetProfile: params.budgetProfile ?? "normal",
        now,
        idSuffix: params.initiativeIdSuffix,
      }
    : {
        rawInput: params.rawInput,
        repoPath: params.repoPath,
        source: params.source,
        riskProfile: params.riskProfile ?? "dev",
        budgetProfile: params.budgetProfile ?? "normal",
        now,
      };
  const initiative = createInitiativeFromInput(initiativeParams);
  const plannerInput: PlannerRunInput = {
    runId,
    initiative,
    policy: params.policy,
    requestedAt: now.toISOString(),
  };
  const maxAttempts = params.maxAttempts ?? 2;

  appendAuditEvent(params.workspacePath, {
    eventType: "planner_provider_selected",
    runId,
    timestamp: now.toISOString(),
    payload: {
      plannerModelId: params.plannerModel.id,
      provider: params.plannerModel.provider,
      maxAttempts,
      budgetProfile: initiative.budgetProfile,
    },
  });

  let plannerOutput: PlannerRunOutput;
  try {
    plannerOutput = await params.executePlanner(plannerInput, { maxAttempts });
  } catch (error) {
    handlePlannerExecutionFailure({
      workspacePath: params.workspacePath,
      runId,
      plannerModel: params.plannerModel,
      now,
      error,
    });
    throw error;
  }

  appendPlannerRetryEvents({
    workspacePath: params.workspacePath,
    runId,
    now,
    records: plannerOutput.retry.records,
  });
  const budgetMetadata: PlannerBudgetMetadata = {
    profile: initiative.budgetProfile,
    remainingUsdEstimate: remainingBudgetAfterEstimatedCost({
      budgetProfile: initiative.budgetProfile,
      estimatedCostUsd: plannerOutput.cost.estimatedUsd,
    }),
  };
  appendPlannerSuccessEvent({
    workspacePath: params.workspacePath,
    runId,
    now,
    plannerOutput,
    budgetMetadata,
  });

  let modelInvocationRef: string | undefined;
  if (params.persistRunArtifacts ?? true) {
    modelInvocationRef = persistPlannerRunArtifacts({
      planParams: params,
      runId,
      initiative,
      plannerInput,
      plannerOutput,
      budgetMetadata,
      now,
    });
  }

  return {
    runId,
    initiative,
    taskGraph: plannerOutput.taskGraph,
    plannerInput,
    plannerOutput: {
      plannerModelId: params.plannerModel.id,
      ...(modelInvocationRef ? { modelInvocationRef } : {}),
      budget: budgetMetadata,
      ...plannerOutput,
    },
    plannerModelId: params.plannerModel.id,
    providerName: plannerOutput.providerName,
    budgetMetadata,
    ...(modelInvocationRef ? { modelInvocationRef } : {}),
    workspacePath: params.workspacePath,
    repoId: params.repoId,
    repoPath: params.repoPath,
  };
}
