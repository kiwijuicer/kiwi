import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import {
  ContractValues,
  EvidenceSubject,
  GateResult,
  GateResultSchema,
  GateStatus,
  GateType,
  KiwiPolicy,
} from "@kiwi/contracts";
import { resolveRunArtifactPath } from "@kiwi/core";

export interface CreateGateResultParams {
  gateType: GateType;
  status: GateStatus;
  evidenceRefs: string[];
  reason: string;
  gateId?: string;
  subject?: EvidenceSubject;
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
  const result = {
    gateId,
    gateType: params.gateType,
    status: params.status,
    evidenceRefs: params.evidenceRefs,
    reason: params.reason,
    ...(params.subject ? { subject: params.subject } : {}),
  };
  return GateResultSchema.parse(result);
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

interface DiffFileInfo {
  filePath: string;
}

const DIFF_FILE_REGEX = /^diff (?:--git|--kiwi) a\/(.+?) b\/(.+)$/;

export function extractDiffFiles(diff: string): DiffFileInfo[] {
  const out: DiffFileInfo[] = [];
  const seen = new Set<string>();
  for (const line of diff.split("\n")) {
    const match = DIFF_FILE_REGEX.exec(line);
    if (!match) continue;
    const filePath = match[2] ?? match[1];
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    out.push({ filePath });
  }
  return out;
}

function wildcardPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

function pathMatches(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => wildcardPatternToRegExp(pattern).test(filePath));
}

export interface ForbiddenFileCheckResult {
  status: GateStatus;
  reason: string;
  blockedFiles: string[];
  approvalRequiredFiles: string[];
  scannedFiles: string[];
  diffHash: string;
  patterns: { highRisk: string[]; deniedPaths: string[] };
}

export function evaluateForbiddenFiles(params: {
  diff: string;
  diffHash: string;
  policy: KiwiPolicy;
  approvedPaths?: boolean;
}): ForbiddenFileCheckResult {
  const files = extractDiffFiles(params.diff).map((entry) => entry.filePath);
  const denied: string[] = [];
  const allDeniedPatterns = new Set<string>();
  const profile = params.policy.commandProfiles.coding ?? params.policy.commandProfiles.default;
  if (profile) {
    for (const pattern of profile.deniedPaths) allDeniedPatterns.add(pattern);
  }
  const approvalPatterns = profile ? profile.approvalRequiredPaths : [];
  const highRiskPatterns = params.policy.riskZones.high;

  const blockedFiles: string[] = [];
  const approvalRequiredFiles: string[] = [];
  for (const file of files) {
    if (pathMatches(file, [...allDeniedPatterns])) blockedFiles.push(file);
    if (pathMatches(file, approvalPatterns)) approvalRequiredFiles.push(file);
    if (pathMatches(file, highRiskPatterns)) approvalRequiredFiles.push(file);
  }
  void denied;
  if (blockedFiles.length > 0) {
    return {
      status: ContractValues.Blocked,
      reason: `Diff touches denied paths: ${blockedFiles.join(", ")}`,
      blockedFiles,
      approvalRequiredFiles,
      scannedFiles: files,
      diffHash: params.diffHash,
      patterns: { highRisk: highRiskPatterns, deniedPaths: [...allDeniedPatterns] },
    };
  }
  if (approvalRequiredFiles.length > 0 && !params.approvedPaths) {
    return {
      status: ContractValues.Fail,
      reason: `Diff touches approval-required paths: ${[...new Set(approvalRequiredFiles)].join(", ")}`,
      blockedFiles: [],
      approvalRequiredFiles: [...new Set(approvalRequiredFiles)],
      scannedFiles: files,
      diffHash: params.diffHash,
      patterns: { highRisk: highRiskPatterns, deniedPaths: [...allDeniedPatterns] },
    };
  }
  return {
    status: ContractValues.Pass,
    reason: files.length === 0 ? "No diff files to evaluate" : `${files.length} diff files within policy bounds`,
    blockedFiles: [],
    approvalRequiredFiles: [...new Set(approvalRequiredFiles)],
    scannedFiles: files,
    diffHash: params.diffHash,
    patterns: { highRisk: highRiskPatterns, deniedPaths: [...allDeniedPatterns] },
  };
}

export interface SecretsScanResult {
  status: GateStatus;
  reason: string;
  findings: Array<{ pattern: string; sample: string }>;
  diffHash: string;
}

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "anthropic_api_key", regex: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/ },
  { name: "openai_api_key", regex: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { name: "aws_access_key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github_token", regex: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: "private_key_block", regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----/ },
  { name: "key_value_assignment", regex: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{12,}["']/i },
];

export function scanForSecrets(params: { diff: string; diffHash: string }): SecretsScanResult {
  const findings: Array<{ pattern: string; sample: string }> = [];
  for (const pattern of SECRET_PATTERNS) {
    const match = pattern.regex.exec(params.diff);
    if (match) {
      findings.push({
        pattern: pattern.name,
        sample: match[0].slice(0, 8) + "***",
      });
    }
  }
  if (findings.length > 0) {
    return {
      status: ContractValues.Fail,
      reason: `Secrets detected: ${findings.map((entry) => entry.pattern).join(", ")}`,
      findings,
      diffHash: params.diffHash,
    };
  }
  return {
    status: ContractValues.Pass,
    reason: "No secrets detected in diff",
    findings: [],
    diffHash: params.diffHash,
  };
}

function writeGateReport(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  fileName: string;
  payload: unknown;
}): string {
  const relativePath = `steps/${params.stepId}/${params.attemptId}/artifacts/${params.fileName}`;
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  writeJsonSafely(target, params.payload);
  return relativePath;
}

export interface DiffGateInput {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  diff: string;
  diffHash: string;
  policy: KiwiPolicy;
  approvedPaths?: boolean;
}

export function runForbiddenFileGate(input: DiffGateInput): GateResult {
  const result = evaluateForbiddenFiles({
    diff: input.diff,
    diffHash: input.diffHash,
    policy: input.policy,
    ...(input.approvedPaths !== undefined ? { approvedPaths: input.approvedPaths } : {}),
  });
  const reportPath = writeGateReport({
    cwd: input.cwd,
    runId: input.runId,
    stepId: input.stepId,
    attemptId: input.attemptId,
    fileName: "forbidden-file-report.json",
    payload: { schemaVersion: "1", ...result },
  });
  return GateResultSchema.parse({
    gateId: "gate_forbidden_file_checks",
    gateType: "forbidden_file_checks",
    status: result.status,
    evidenceRefs: [reportPath],
    reason: result.reason,
    subject: { type: "diff", hash: input.diffHash },
  });
}

export function runSecretsScanGate(input: DiffGateInput): GateResult {
  const result = scanForSecrets({ diff: input.diff, diffHash: input.diffHash });
  const reportPath = writeGateReport({
    cwd: input.cwd,
    runId: input.runId,
    stepId: input.stepId,
    attemptId: input.attemptId,
    fileName: "secrets-report.json",
    payload: { schemaVersion: "1", ...result },
  });
  return GateResultSchema.parse({
    gateId: "gate_secrets_check",
    gateType: "secrets_check",
    status: result.status,
    evidenceRefs: [reportPath],
    reason: result.reason,
    subject: { type: "diff", hash: input.diffHash },
  });
}
