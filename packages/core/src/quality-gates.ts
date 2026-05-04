import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { ContractValues, GateResult, GateResultSchema, GateStatus, GateType } from "@kiwi/contracts";
import { resolveRunArtifactPath } from "./run-store";

export interface CreateGateResultParams {
  gateType: GateType;
  status: GateStatus;
  evidenceRefs: string[];
  reason: string;
  gateId?: string;
}

export interface QualityGateSummary {
  overallStatus: GateStatus;
  safeToContinue: boolean;
  failingGateIds: string[];
  blockedGateIds: string[];
  evidenceRefs: string[];
}

function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

export function createGateResult(params: CreateGateResultParams): GateResult {
  const gateId = params.gateId ?? `gate_${params.gateType}`;
  return GateResultSchema.parse({
    gateId,
    gateType: params.gateType,
    status: params.status,
    evidenceRefs: params.evidenceRefs,
    reason: params.reason,
  });
}

export function summarizeGateResults(results: GateResult[]): QualityGateSummary {
  const parsed = results.map((entry) => GateResultSchema.parse(entry));
  const failing = parsed.filter((entry) => entry.status === ContractValues.Fail);
  const blocked = parsed.filter((entry) => entry.status === ContractValues.Blocked);
  const evidenceRefs = parsed.flatMap((entry) => entry.evidenceRefs);

  if (blocked.length > 0) {
    return {
      overallStatus: ContractValues.Blocked,
      safeToContinue: false,
      failingGateIds: failing.map((entry) => entry.gateId),
      blockedGateIds: blocked.map((entry) => entry.gateId),
      evidenceRefs,
    };
  }

  if (failing.length > 0) {
    return {
      overallStatus: ContractValues.Fail,
      safeToContinue: false,
      failingGateIds: failing.map((entry) => entry.gateId),
      blockedGateIds: [],
      evidenceRefs,
    };
  }

  return {
    overallStatus: ContractValues.Pass,
    safeToContinue: true,
    failingGateIds: [],
    blockedGateIds: [],
    evidenceRefs,
  };
}

export function saveGateResults(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  gateResults: GateResult[];
}): string {
  const validated = params.gateResults.map((entry) => GateResultSchema.parse(entry));
  const relativePath = `steps/${params.stepId}/${params.attemptId}/gate-results.json`;
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  writeJsonSafely(target, validated);
  return relativePath;
}

export function loadGateResults(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
}): GateResult[] {
  const relativePath = `steps/${params.stepId}/${params.attemptId}/gate-results.json`;
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  if (!existsSync(target)) {
    throw new Error(`gate results not found: ${relativePath}`);
  }

  const parsed = JSON.parse(readFileSync(target, "utf-8")) as unknown;
  return (parsed as unknown[]).map((entry) => GateResultSchema.parse(entry));
}
