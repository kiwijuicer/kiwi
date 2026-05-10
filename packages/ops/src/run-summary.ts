import { existsSync, readFileSync } from "fs";
import {
  AccessMode,
  AccessModes,
  ContractValues,
  ModelInvocationPhase,
  ModelInvocationRecord,
  RunCompletionPhaseSummary,
  RunCompletionSummary,
  RunCompletionSummarySchema,
} from "@kiwi/contracts";
import {
  buildFinalCostReportFromModelInvocations,
  latestAttemptByStep,
  listStepAttemptEvidence,
  loadRunManifest,
  readAuditEvents,
  readModelInvocations,
  resolveRunArtifactPath,
} from "@kiwi/core";

// Local copy of inferAccessMode. Kept in lockstep with
// packages/core/src/model-invocations.ts:inferAccessMode.
// Local because @kiwi/core's dist must be rebuilt before the cross-
// package import resolves; this avoids a build-order trap.
function inferAccessMode(record: ModelInvocationRecord): AccessMode | null {
  if (record.accessMode) return record.accessMode;
  if (record.runner === "claude-code") return AccessModes.ClaudeCodeCli;
  if (record.runner === "codex") return AccessModes.CodexCli;
  if (record.runner === "cursor-agent") return AccessModes.CursorAgentCli;
  if (record.runner === "local-shell") return AccessModes.Local;
  if (record.providerName === "stub" || record.providerName.startsWith("stub")) return AccessModes.Stub;
  return null;
}

const PHASES: ModelInvocationPhase[] = [ContractValues.Planner, ContractValues.Executor, ContractValues.Reviewer];

interface UsagePrecisionCounts {
  exact: number;
  estimated: number;
  unknown: number;
}

interface RunStepCosts {
  planner: number;
  executor: number;
  reviewer: number;
}

export interface RunRoutingExplanation {
  stepId: string;
  attemptId: string;
  status: string;
  selectedCapability?: string;
  executorReason?: string;
  modelId?: string | null;
  providerModel?: string | null;
  providerName?: string | null;
  accessMode?: string | null;
  runner?: string | null;
  estimatedAttemptCostUsd?: number;
  executionOwner?: string;
  executionIsolation?: string;
  requiredGates: string[];
  routingReason: string[];
}

type SchedulerDecisionWithModelMetadata = NonNullable<ReturnType<typeof listStepAttemptEvidence>[number]["schedulerDecision"]> & {
  selectedModelId?: string | null;
  selectedProviderModel?: string | null;
  selectedAccessMode?: string | null;
  estimatedAttemptCostUsd?: number;
  executionOwner?: string;
  executionIsolation?: string;
};

export interface RunGateExplanation {
  stepId: string;
  attemptId: string;
  gateId: string;
  gateType: string;
  status: string;
  reason: string;
}

export interface RunExplanation {
  schemaVersion: "1";
  runId: string;
  completionSummary: RunCompletionSummary;
  routing: RunRoutingExplanation[];
  gates: RunGateExplanation[];
  nextAction: string;
}

function emptyPrecisionCounts(): UsagePrecisionCounts {
  return { exact: 0, estimated: 0, unknown: 0 };
}

function addPrecision(target: UsagePrecisionCounts, invocation: ModelInvocationRecord): void {
  target[invocation.usagePrecision] += 1;
}

function modelLabel(record: ModelInvocationRecord): string {
  const accessMode = inferAccessMode(record);
  const target = accessMode ?? record.runner ?? record.modelId ?? record.providerName;
  return `${record.selectedCapability}/${target}`;
}

function costModelLabel(record: ModelInvocationRecord): string {
  const runner = record.runner ?? "none";
  const accessMode = inferAccessMode(record) ?? "none";
  const modelId = record.modelId ?? "unknown";
  return `${record.selectedCapability}/${runner}|${accessMode}|${record.providerName}|${modelId}`;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

function emptyStepCosts(): RunStepCosts {
  return { planner: 0, executor: 0, reviewer: 0 };
}

function phaseSummary(phase: ModelInvocationPhase, invocations: ModelInvocationRecord[]): RunCompletionPhaseSummary {
  const records = invocations.filter((record) => record.phase === phase);
  const usagePrecision = emptyPrecisionCounts();
  const models = new Set<string>();
  const accessModes = new Set<AccessMode>();
  let costUsd = 0;

  for (const record of records) {
    costUsd += record.estimatedCostUsd ?? 0;
    addPrecision(usagePrecision, record);
    models.add(modelLabel(record));
    const accessMode = inferAccessMode(record);
    if (accessMode) accessModes.add(accessMode);
  }

  return {
    phase,
    costUsd,
    invocations: records.length,
    usagePrecision,
    models: Array.from(models).sort(),
    accessModes: Array.from(accessModes).sort(),
  };
}

function readFinalVerdict(cwd: string, runId: string): { verdict: string; safeToApply: boolean | null } {
  const target = resolveRunArtifactPath(runId, "final/final-verdict.json", cwd);
  if (!existsSync(target)) return { verdict: "missing", safeToApply: null };
  const parsed = JSON.parse(readFileSync(target, "utf-8")) as { verdict?: string; safeToApply?: boolean };
  return {
    verdict: parsed.verdict ?? "missing",
    safeToApply: typeof parsed.safeToApply === "boolean" ? parsed.safeToApply : null,
  };
}

function nextAction(params: {
  finalVerdict: string;
  safeToApply: boolean | null;
  failed: number;
  blocked: number;
  status: string;
}): string {
  if (params.safeToApply === true) return "complete";
  if (params.blocked > 0) return "resolve_blocker";
  if (params.failed > 0) return "fix_step";
  if (params.finalVerdict === "missing" && params.status !== ContractValues.Completed) return "continue_or_finalize";
  if (params.finalVerdict === "missing") return "finalize";
  return "review_final_verdict";
}

function costQualifier(usagePrecision: UsagePrecisionCounts): string {
  if (usagePrecision.unknown > 0) return "partial estimate";
  return "estimated";
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function compactLine(params: {
  totalEstimatedCostUsd: number;
  usagePrecision: UsagePrecisionCounts;
  phaseSummaries: Record<ModelInvocationPhase, RunCompletionPhaseSummary>;
  finalVerdict: string;
}): string {
  const phaseLabels = PHASES.map((phase) => {
    const summary = params.phaseSummaries[phase];
    const label = summary.models[0] ?? "none";
    return `${phase} ${label}`;
  });
  return [
    `cost: ${formatUsd(params.totalEstimatedCostUsd)} ${costQualifier(params.usagePrecision)}`,
    ...phaseLabels,
    `verdict: ${params.finalVerdict}`,
  ].join(" · ");
}

function stringPayloadValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function executorReasonByAttempt(cwd: string, runId: string): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const event of readAuditEvents(cwd, runId)) {
    if (String(event.eventType) !== "executor_model_selected") continue;
    const attemptId = stringPayloadValue(event.payload, "attemptId");
    const reason = stringPayloadValue(event.payload, "reason");
    if (attemptId && reason) reasons.set(attemptId, reason);
  }
  return reasons;
}

function executorSelectionByAttempt(
  cwd: string,
  runId: string,
): Map<string, { modelId: string | null; providerName: string | null; accessMode: string | null }> {
  const selections = new Map<string, { modelId: string | null; providerName: string | null; accessMode: string | null }>();
  for (const event of readAuditEvents(cwd, runId)) {
    if (String(event.eventType) !== "executor_model_selected") continue;
    const attemptId = stringPayloadValue(event.payload, "attemptId");
    if (!attemptId) continue;
    selections.set(attemptId, {
      modelId: typeof event.payload.modelId === "string" ? event.payload.modelId : null,
      providerName: typeof event.payload.providerName === "string" ? event.payload.providerName : null,
      accessMode: typeof event.payload.accessMode === "string" ? event.payload.accessMode : null,
    });
  }
  return selections;
}

export function buildRunCompletionSummary(params: { cwd: string; runId: string; now?: Date }): RunCompletionSummary {
  const run = loadRunManifest(params.runId, params.cwd);
  const invocations = readModelInvocations(params.cwd, params.runId);
  const costReport = buildFinalCostReportFromModelInvocations(params);
  const usagePrecision = emptyPrecisionCounts();
  const byStepCostsUsd: Record<string, RunStepCosts> = {};
  const byModelCostsUsd: Record<string, number> = {};
  for (const invocation of invocations) addPrecision(usagePrecision, invocation);
  for (const invocation of invocations) {
    const estimatedCost = invocation.estimatedCostUsd ?? 0;
    if (invocation.stepId) {
      const current = byStepCostsUsd[invocation.stepId] ?? emptyStepCosts();
      current[invocation.phase] = roundUsd(current[invocation.phase] + estimatedCost);
      byStepCostsUsd[invocation.stepId] = current;
    }
    const modelCostKey = costModelLabel(invocation);
    byModelCostsUsd[modelCostKey] = roundUsd((byModelCostsUsd[modelCostKey] ?? 0) + estimatedCost);
  }

  const phaseSummaries = {
    planner: phaseSummary(ContractValues.Planner, invocations),
    executor: phaseSummary(ContractValues.Executor, invocations),
    reviewer: phaseSummary(ContractValues.Reviewer, invocations),
  };
  const attempts = listStepAttemptEvidence(params.cwd, params.runId);
  const latest = Array.from(latestAttemptByStep(attempts).values());
  const failed = latest.filter((entry) => entry.attempt.status === ContractValues.Failed);
  const blocked = latest.filter((entry) => entry.attempt.status === ContractValues.Blocked);
  const completed = latest.filter((entry) => entry.attempt.status === ContractValues.Completed);
  const final = readFinalVerdict(params.cwd, params.runId);
  const warnings: string[] = [];
  if (usagePrecision.unknown >= Math.max(1, Math.ceil(invocations.length / 4))) {
    warnings.push(
      "cost_precision_unknown_dominant: most invocations have unknown token precision; verify provider usage metadata.",
    );
  }
  const action = nextAction({
    finalVerdict: final.verdict,
    safeToApply: final.safeToApply,
    failed: failed.length,
    blocked: blocked.length,
    status: run.status,
  });

  const summaryInput = {
    schemaVersion: "1",
    runId: params.runId,
    status: run.status,
    totalEstimatedCostUsd: costReport.totalEstimatedUsd,
    currency: "USD",
    usagePrecision,
    phaseCostsUsd: {
      planner: costReport.plannerCostUsd,
      executor: costReport.executorCostUsd,
      reviewer: costReport.reviewerCostUsd,
    },
    phaseSummaries,
    byStepCostsUsd,
    byModelCostsUsd,
    warnings,
    attempts: {
      total: attempts.length,
      completed: completed.length,
      failed: failed.length,
      blocked: blocked.length,
    },
    failedStepIds: failed.map((entry) => entry.stepId),
    blockedStepIds: blocked.map((entry) => entry.stepId),
    finalVerdict: final.verdict,
    safeToApply: final.safeToApply,
    nextAction: action,
    compact: compactLine({
      totalEstimatedCostUsd: costReport.totalEstimatedUsd,
      usagePrecision,
      phaseSummaries,
      finalVerdict: final.verdict,
    }),
    generatedAt: (params.now ?? new Date()).toISOString(),
  };

  return RunCompletionSummarySchema.parse(summaryInput);
}

export function buildRunExplanation(params: { cwd: string; runId: string; now?: Date }): RunExplanation {
  const attempts = listStepAttemptEvidence(params.cwd, params.runId);
  const executorReasons = executorReasonByAttempt(params.cwd, params.runId);
  const executorSelections = executorSelectionByAttempt(params.cwd, params.runId);
  const routing = attempts
    .filter((entry) => entry.schedulerDecision)
    .map((entry) => {
      const schedulerDecision = entry.schedulerDecision! as SchedulerDecisionWithModelMetadata;
      const executorReason = executorReasons.get(entry.attemptId);
      const executorSelection = executorSelections.get(entry.attemptId);
      return {
        stepId: entry.stepId,
        attemptId: entry.attemptId,
        status: schedulerDecision.status,
        selectedCapability: schedulerDecision.modelCapability,
        ...(executorReason ? { executorReason } : {}),
        ...(executorSelection ? executorSelection : {}),
        modelId: schedulerDecision.selectedModelId ?? executorSelection?.modelId ?? null,
        providerModel: schedulerDecision.selectedProviderModel ?? null,
        accessMode: schedulerDecision.selectedAccessMode ?? executorSelection?.accessMode ?? null,
        runner: schedulerDecision.runner,
        ...(schedulerDecision.estimatedAttemptCostUsd !== undefined
          ? { estimatedAttemptCostUsd: schedulerDecision.estimatedAttemptCostUsd }
          : {}),
        ...(schedulerDecision.executionOwner ? { executionOwner: schedulerDecision.executionOwner } : {}),
        ...(schedulerDecision.executionIsolation ? { executionIsolation: schedulerDecision.executionIsolation } : {}),
        requiredGates: schedulerDecision.requiredGates,
        routingReason: schedulerDecision.routingReason,
      };
    });
  const gates = attempts.flatMap((entry) =>
    entry.gateResults.map((gate) => ({
      stepId: entry.stepId,
      attemptId: entry.attemptId,
      gateId: gate.gateId,
      gateType: gate.gateType,
      status: gate.status,
      reason: gate.reason,
    })),
  );

  const auditBlocked: RunRoutingExplanation[] = readAuditEvents(params.cwd, params.runId)
    .filter((event) => event.eventType === "scheduler_blocked")
    .map((event) => {
      const selectedCapability = stringPayloadValue(event.payload, "modelCapability");
      return {
        stepId: String(event.payload.stepId ?? "unknown"),
        attemptId: stringPayloadValue(event.payload, "attemptId") ?? "unknown",
        status: ContractValues.Blocked,
        ...(selectedCapability ? { selectedCapability } : {}),
        runner: null,
        requiredGates: [],
        routingReason: Array.isArray(event.payload.routingReason)
          ? event.payload.routingReason.filter((entry): entry is string => typeof entry === "string")
          : [String(event.payload.reason ?? "scheduler_blocked")],
      };
    });
  const completionSummary = buildRunCompletionSummary(params);

  return {
    schemaVersion: "1",
    runId: params.runId,
    completionSummary,
    routing: [...routing, ...auditBlocked],
    gates,
    nextAction: completionSummary.nextAction,
  };
}
