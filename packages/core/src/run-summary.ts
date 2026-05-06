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
import { readAuditEvents } from "./cost-ledger";
import { buildFinalCostReportFromModelInvocations, readModelInvocations } from "./model-invocations";
import { loadRunManifest, resolveRunArtifactPath } from "./run-store";
import { latestAttemptByStep, listStepAttemptEvidence } from "./lifecycle";

const PHASES: ModelInvocationPhase[] = [ContractValues.Planner, ContractValues.Executor, ContractValues.Reviewer];

interface UsagePrecisionCounts {
  exact: number;
  estimated: number;
  unknown: number;
}

export interface RunRoutingExplanation {
  stepId: string;
  attemptId: string;
  status: string;
  selectedCapability?: string;
  runner?: string | null;
  requiredGates: string[];
  routingReason: string[];
}

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

function inferAccessMode(record: ModelInvocationRecord): AccessMode | null {
  if (record.accessMode) return record.accessMode;
  if (record.runner === "claude-code") return AccessModes.ClaudeCodeCli;
  if (record.runner === "codex") return AccessModes.CodexCli;
  if (record.runner === "cursor-agent") return AccessModes.CursorAgentCli;
  if (record.runner === "local-shell") return AccessModes.Local;
  if (record.providerName.startsWith("stub")) return AccessModes.Stub;
  return null;
}

function modelLabel(record: ModelInvocationRecord): string {
  const accessMode = inferAccessMode(record);
  const target = accessMode ?? record.runner ?? record.modelId ?? record.providerName;
  return `${record.selectedCapability}/${target}`;
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

export function buildRunCompletionSummary(params: { cwd: string; runId: string; now?: Date }): RunCompletionSummary {
  const run = loadRunManifest(params.runId, params.cwd);
  const invocations = readModelInvocations(params.cwd, params.runId);
  const costReport = buildFinalCostReportFromModelInvocations(params);
  const usagePrecision = emptyPrecisionCounts();
  for (const invocation of invocations) addPrecision(usagePrecision, invocation);

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
  const routing = attempts
    .filter((entry) => entry.schedulerDecision)
    .map((entry) => ({
      stepId: entry.stepId,
      attemptId: entry.attemptId,
      status: entry.schedulerDecision!.status,
      selectedCapability: entry.schedulerDecision!.modelCapability,
      runner: entry.schedulerDecision!.runner,
      requiredGates: entry.schedulerDecision!.requiredGates,
      routingReason: entry.schedulerDecision!.routingReason,
    }));
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
    .map((event) => ({
      stepId: String(event.payload.stepId ?? "unknown"),
      attemptId: "unknown",
      status: ContractValues.Blocked,
      runner: null,
      requiredGates: [],
      routingReason: Array.isArray(event.payload.routingReason)
        ? event.payload.routingReason.filter((entry): entry is string => typeof entry === "string")
        : [String(event.payload.reason ?? "scheduler_blocked")],
    }));
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
