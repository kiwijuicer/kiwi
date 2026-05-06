import { existsSync, readFileSync } from "fs";
import {
  AgentRole,
  Artifact,
  ArtifactSchema,
  ModelCapability,
  RunnerName,
  StepAttempt,
  StepAttemptSchema,
  StepAttemptStatus,
  UsagePrecision,
} from "@kiwi/contracts";
import { resolveRunArtifactPath, writeJsonSafely } from "@kiwi/core";
import type {
  StepAttemptNextAction,
  StepRunnerExecutionError,
  StepRunnerExecutionStatus,
  StepRunnerModelUsage,
} from "./step-runner-types";

interface RunnerCostReport {
  schemaVersion: "1";
  runId: string;
  stepId: string;
  attemptId: string;
  runner: RunnerName;
  modelId: string | null;
  providerName: string;
  agentRole: AgentRole;
  modelCapability: ModelCapability;
  reviewDepth: ModelCapability;
  modelInvocationRefs: string[];
  modelUsage: StepRunnerModelUsage;
  usagePrecision: UsagePrecision;
  estimatedCostUsd: number | null;
  createdAt: string;
}

interface AttemptSummary {
  schemaVersion: "1";
  runId: string;
  stepId: string;
  attemptId: string;
  status: StepAttemptStatus;
  runnerStatus: StepRunnerExecutionStatus;
  nextAction: StepAttemptNextAction;
  gateResultsRef: string;
  reviewReportRef: string;
  costReportRef: string;
  modelInvocationRefs: string[];
  artifactRefs: string[];
  completedAt: string;
  error?: StepRunnerExecutionError;
}

function attemptRef(stepId: string, attemptId: string): string {
  return `steps/${stepId}/${attemptId}/attempt.json`;
}

export function loadStepAttempt(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
}): StepAttempt {
  const relativePath = attemptRef(params.stepId, params.attemptId);
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  if (!existsSync(target)) {
    throw new Error(`step attempt not found: ${relativePath}`);
  }
  return StepAttemptSchema.parse(JSON.parse(readFileSync(target, "utf-8")));
}

export function saveStepAttempt(params: { cwd: string; runId: string; attempt: StepAttempt }): string {
  const relativePath = attemptRef(params.attempt.stepId, params.attempt.attemptId);
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  writeJsonSafely(target, StepAttemptSchema.parse(params.attempt));
  return relativePath;
}

export function artifact(params: {
  type: Artifact["type"];
  ref: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}): Artifact {
  const value: Artifact = {
    type: params.type,
    ref: params.ref,
    createdAt: params.createdAt,
  };
  if (params.metadata) value.metadata = params.metadata;
  return ArtifactSchema.parse(value);
}

export function dedupeArtifacts(artifacts: Artifact[]): Artifact[] {
  const seen = new Set<string>();
  const deduped: Artifact[] = [];
  for (const entry of artifacts.map((item) => ArtifactSchema.parse(item))) {
    const key = `${entry.type}:${entry.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

export function saveRunnerCostReport(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  runner: RunnerName;
  modelId: string | null;
  providerName: string;
  agentRole: AgentRole;
  modelCapability: ModelCapability;
  reviewDepth: ModelCapability;
  modelInvocationRefs: string[];
  modelUsage: StepRunnerModelUsage;
  usagePrecision: UsagePrecision;
  estimatedCostUsd: number | null;
  createdAt: string;
}): string {
  const relativePath = `steps/${params.stepId}/${params.attemptId}/artifacts/cost-report.json`;
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  const report: RunnerCostReport = {
    schemaVersion: "1",
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    runner: params.runner,
    modelId: params.modelId,
    providerName: params.providerName,
    agentRole: params.agentRole,
    modelCapability: params.modelCapability,
    reviewDepth: params.reviewDepth,
    modelInvocationRefs: params.modelInvocationRefs,
    modelUsage: params.modelUsage,
    usagePrecision: params.usagePrecision,
    estimatedCostUsd: params.estimatedCostUsd,
    createdAt: params.createdAt,
  };
  writeJsonSafely(target, report);
  return relativePath;
}

export function saveAttemptSummary(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  summary: AttemptSummary;
}): string {
  const relativePath = `steps/${params.stepId}/${params.attemptId}/artifacts/attempt-summary.json`;
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  writeJsonSafely(target, params.summary);
  return relativePath;
}
