import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import {
  AccessMode,
  AccessModes,
  FinalCostReport,
  FinalCostReportSchema,
  ModelInvocationPhase,
  ModelInvocationRecord,
  ModelInvocationRecordSchema,
  ModelUsageSummary,
  ModelUsageSummarySchema,
  ModelUsageSummaryTotals,
} from "@kiwi/contracts";
import { appendAuditEvent } from "./cost-ledger";
import { ensureRunLayout, resolveRunArtifactPath } from "./run-store";

export const MODEL_INVOCATIONS_REF = "model-invocations.jsonl";
export const MODEL_USAGE_SUMMARY_REF = "final/model-usage-summary.json";

function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

function emptyTotals(): ModelUsageSummaryTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };
}

function addTotals(target: ModelUsageSummaryTotals, record: ModelInvocationRecord): void {
  target.inputTokens += record.usage.inputTokens;
  target.outputTokens += record.usage.outputTokens;
  target.estimatedCostUsd += record.estimatedCostUsd ?? 0;
}

function inferAccessMode(record: ModelInvocationRecord): AccessMode | null {
  if (record.accessMode) return record.accessMode;
  if (record.runner === "claude-code") return AccessModes.ClaudeCodeCli;
  if (record.runner === "codex") return AccessModes.CodexCli;
  if (record.runner === "cursor-agent") return AccessModes.CursorAgentCli;
  if (record.runner === "local-shell") return AccessModes.Local;
  if (record.providerName === "stub") return AccessModes.Stub;
  return null;
}

function uniqueInvocationModels(invocations: ModelInvocationRecord[]): FinalCostReport["models"] {
  const seen = new Set<string>();
  const models: FinalCostReport["models"] = [];
  for (const invocation of invocations) {
    const accessMode = inferAccessMode(invocation);
    const entry = {
      phase: invocation.phase,
      selectedCapability: invocation.selectedCapability,
      modelId: invocation.modelId,
      providerName: invocation.providerName,
      runner: invocation.runner,
      ...(accessMode ? { accessMode } : {}),
    };
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    models.push(entry);
  }
  return models;
}

export function appendModelInvocation(cwd: string, record: ModelInvocationRecord): string {
  const parsed = ModelInvocationRecordSchema.parse(record);
  ensureRunLayout(parsed.runId, cwd);
  const target = resolveRunArtifactPath(parsed.runId, MODEL_INVOCATIONS_REF, cwd);
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify(parsed)}\n`, "utf-8");
  appendAuditEvent(cwd, {
    eventType: "model_invocation_recorded",
    runId: parsed.runId,
    timestamp: parsed.completedAt,
    payload: {
      phase: parsed.phase,
      stepId: parsed.stepId,
      attemptId: parsed.attemptId,
      agentRole: parsed.agentRole,
      selectedCapability: parsed.selectedCapability,
      modelId: parsed.modelId,
      providerName: parsed.providerName,
      runner: parsed.runner,
      accessMode: parsed.accessMode ?? null,
      status: parsed.status,
      usage: parsed.usage,
      usagePrecision: parsed.usagePrecision,
      estimatedCostUsd: parsed.estimatedCostUsd,
    },
  });
  return [
    MODEL_INVOCATIONS_REF,
    [parsed.phase, parsed.stepId, parsed.attemptId, parsed.completedAt.replace(/[^0-9TZ]/g, "")]
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join(":"),
  ].join("#");
}

export function readModelInvocations(cwd: string, runId: string): ModelInvocationRecord[] {
  const target = resolveRunArtifactPath(runId, MODEL_INVOCATIONS_REF, cwd);
  if (!existsSync(target)) return [];

  return readFileSync(target, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ModelInvocationRecordSchema.parse(JSON.parse(line) as unknown));
}

export function summarizeModelInvocations(params: { cwd: string; runId: string; now?: Date }): ModelUsageSummary {
  const invocations = readModelInvocations(params.cwd, params.runId);
  const totals = emptyTotals();
  const byPhase: Record<ModelInvocationPhase, ModelUsageSummaryTotals> = {
    planner: emptyTotals(),
    executor: emptyTotals(),
    reviewer: emptyTotals(),
  };

  for (const invocation of invocations) {
    addTotals(totals, invocation);
    addTotals(byPhase[invocation.phase], invocation);
  }

  return ModelUsageSummarySchema.parse({
    schemaVersion: "1",
    runId: params.runId,
    invocationCount: invocations.length,
    totals,
    byPhase,
    invocations,
    generatedAt: (params.now ?? new Date()).toISOString(),
  });
}

export function writeModelUsageSummary(params: { cwd: string; runId: string; now?: Date }): {
  summary: ModelUsageSummary;
  ref: string;
} {
  ensureRunLayout(params.runId, params.cwd);
  const summary = summarizeModelInvocations(params);
  writeJsonSafely(resolveRunArtifactPath(params.runId, MODEL_USAGE_SUMMARY_REF, params.cwd), summary);
  return {
    summary,
    ref: MODEL_USAGE_SUMMARY_REF,
  };
}

export function buildFinalCostReportFromModelInvocations(params: {
  cwd: string;
  runId: string;
  now?: Date;
}): FinalCostReport {
  const invocations = readModelInvocations(params.cwd, params.runId);
  const phaseCosts: Record<ModelInvocationPhase, number> = {
    planner: 0,
    executor: 0,
    reviewer: 0,
  };
  const usagePrecision = {
    exact: 0,
    estimated: 0,
    unknown: 0,
  };

  for (const invocation of invocations) {
    phaseCosts[invocation.phase] += invocation.estimatedCostUsd ?? 0;
    usagePrecision[invocation.usagePrecision] += 1;
  }

  return FinalCostReportSchema.parse({
    schemaVersion: "1",
    runId: params.runId,
    plannerCostUsd: phaseCosts.planner,
    executorCostUsd: phaseCosts.executor,
    reviewerCostUsd: phaseCosts.reviewer,
    runnerCostUsd: phaseCosts.executor + phaseCosts.reviewer,
    totalEstimatedUsd: phaseCosts.planner + phaseCosts.executor + phaseCosts.reviewer,
    usagePrecision,
    models: uniqueInvocationModels(invocations),
    currency: "USD",
    createdAt: (params.now ?? new Date()).toISOString(),
  });
}
