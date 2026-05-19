import { existsSync, readFileSync } from "fs";
import {
  Artifact,
  ArtifactSchema,
  ContractValues,
  EvidenceSubject,
  GateResult,
  GateResultSchema,
  GateTypes,
  KiwiPolicy,
  MutationRequirement,
  MutationRequirements,
  ReviewVerdict,
  ReviewVerdictSchema,
  RunnerExecutionStatuses,
  StepAttemptStatus,
} from "@kiwi/contracts";
import { resolveRunArtifactPath } from "@kiwi/core";
import { SandboxCommandPolicy, SandboxCommandPolicyEvaluator } from "@kiwi/sandbox";
import {
  runForbiddenFileGate,
  runSecretsScanGate,
  saveGateResults,
  summarizeGateResults,
} from "../../gates/quality-gates.js";
import type { AttemptDiff } from "../../review/review-engine.js";
import type { ExecuteStepAttemptInput, StepRunnerExecutionStatus } from "../step-runner-types.js";
import { auditDiffGatesExecuted } from "./audit.js";

const SHELL_TOOL_NAMES = new Set(["bash", "shell", "exec_command", "run_command", "terminal", "command"]);

export function mapRunnerStatusToAttemptStatus(params: {
  runnerStatus: StepRunnerExecutionStatus;
  reviewVerdict: ReviewVerdict;
  gateResults: GateResult[];
}): StepAttemptStatus {
  if (
    params.runnerStatus === ContractValues.Blocked ||
    params.runnerStatus === RunnerExecutionStatuses.ApprovalRequired
  ) {
    return ContractValues.Blocked;
  }
  if (params.runnerStatus === ContractValues.Failed || params.runnerStatus === RunnerExecutionStatuses.Timeout) {
    return ContractValues.Failed;
  }
  const gateSummary = summarizeGateResults(params.gateResults);

  if (gateSummary.blockedGateIds.length > 0) {
    return ContractValues.Blocked;
  }
  if (!gateSummary.safeToContinue) {
    return ContractValues.Failed;
  }
  if (!params.reviewVerdict.safeToContinue) {
    return ContractValues.Failed;
  }

  return ContractValues.Completed;
}

function bindGateSubject(gate: GateResult, subject: EvidenceSubject | null): GateResult {
  if (!subject || gate.subject) {
    return GateResultSchema.parse(gate);
  }

  return GateResultSchema.parse({ ...gate, subject });
}

export function enforceGateResultsBeforePositiveReview(params: {
  gateResults: GateResult[];
  reviewVerdict: ReviewVerdict;
  subject?: EvidenceSubject;
}): ReviewVerdict {
  const gateSummary = summarizeGateResults(params.gateResults);

  if (gateSummary.safeToContinue || !params.reviewVerdict.safeToContinue) {
    return ReviewVerdictSchema.parse(
      params.subject && !params.reviewVerdict.subject
        ? { ...params.reviewVerdict, subject: params.subject }
        : params.reviewVerdict,
    );
  }

  return ReviewVerdictSchema.parse({
    verdict: gateSummary.overallStatus === ContractValues.Blocked ? ContractValues.Reject : ContractValues.NeedsChanges,
    safeToContinue: false,
    issues: [
      {
        code: "GATE_REVIEW_CONFLICT",
        title: "Positive review cannot override failing gates",
        severity: gateSummary.overallStatus === ContractValues.Blocked ? "high" : "medium",
        detail:
          `Failing gates: ${gateSummary.failingGateIds.join(", ")} Blocked gates: ${gateSummary.blockedGateIds.join(", ")}`.trim(),
      },
    ],
    recommendedNextSteps: [
      gateSummary.overallStatus === ContractValues.Blocked
        ? "Replan with policy-compliant steps"
        : "Create a fix step and re-run gates",
    ],
    confidence: 1,
    ...(params.subject ? { subject: params.subject } : {}),
  });
}

function policyGateResults(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  attemptDiff: AttemptDiff | null;
  requiredGates: string[];
  policy?: KiwiPolicy;
  approved?: boolean;
  approvedFiles?: string[];
}): GateResult[] {
  if (!params.policy || !params.attemptDiff) {
    return [];
  }
  const gateResults: GateResult[] = [];

  if (params.requiredGates.includes(GateTypes.ForbiddenFileChecks)) {
    gateResults.push(
      runForbiddenFileGate({
        cwd: params.cwd,
        runId: params.runId,
        stepId: params.stepId,
        attemptId: params.attemptId,
        diff: params.attemptDiff.diff,
        diffHash: params.attemptDiff.diffHash,
        policy: params.policy,
        ...(params.approved !== undefined ? { approvedPaths: params.approved } : {}),
        ...(params.approvedFiles !== undefined ? { approvedFiles: params.approvedFiles } : {}),
      }),
    );
  }
  if (params.requiredGates.includes(GateTypes.SecretsCheck)) {
    gateResults.push(
      runSecretsScanGate({
        cwd: params.cwd,
        runId: params.runId,
        stepId: params.stepId,
        attemptId: params.attemptId,
        diff: params.attemptDiff.diff,
        diffHash: params.attemptDiff.diffHash,
        policy: params.policy,
      }),
    );
  }

  return gateResults;
}

function diffRequiredGate(params: {
  runnerStatus: StepRunnerExecutionStatus;
  mutationRequirement: MutationRequirement;
  attemptDiff: AttemptDiff | null;
}): GateResult | null {
  if (
    params.runnerStatus !== ContractValues.Completed ||
    params.mutationRequirement !== MutationRequirements.MustChangeFiles ||
    params.attemptDiff
  ) {
    return null;
  }

  return GateResultSchema.parse({
    gateId: "gate_diff_required",
    gateType: GateTypes.DiffRequired,
    status: ContractValues.Fail,
    evidenceRefs: [],
    reason: "Step requires file changes, but the completed runner produced no diff artifact",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSandboxCommandPolicy(value: unknown): value is SandboxCommandPolicy {
  return (
    isRecord(value) &&
    Array.isArray(value.allowedCommands) &&
    Array.isArray(value.approvalRequiredPaths) &&
    Array.isArray(value.deniedPaths) &&
    Array.isArray(value.envAllowlist) &&
    Array.isArray(value.secretValues) &&
    typeof value.networkPolicy === "string" &&
    typeof value.timeoutMs === "number" &&
    typeof value.maxOutputBytes === "number"
  );
}

function commandTokens(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().split(/\s+/);
  }

  return null;
}

function shellRecordName(record: Record<string, unknown>): string {
  return [record.tool, record.toolName, record.name, record.type]
    .filter((entry): entry is string => typeof entry === "string")
    .join(" ")
    .toLowerCase();
}

function commandFromShellRecord(record: Record<string, unknown>): string[] | null {
  const direct = commandTokens(record.command ?? record.cmd);

  if (direct) {
    return direct;
  }
  for (const key of ["input", "tool_input", "parameters", "arguments"]) {
    const nested = record[key];

    if (isRecord(nested)) {
      const nestedCommand = commandTokens(nested.command ?? nested.cmd);

      if (nestedCommand) {
        return nestedCommand;
      }
    }
  }

  return null;
}

function parseJsonValuesFromText(text: string): unknown[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

function collectCommandEvents(value: unknown): { commands: string[][]; suspectedShellUsage: boolean } {
  const commands: string[][] = [];
  let suspectedShellUsage = false;
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);

      return;
    }
    if (!isRecord(entry)) {
      if (typeof entry === "string" && /"?(bash|shell|exec_command|run_command)"?/i.test(entry)) {
        const parsed = parseJsonValuesFromText(entry);

        if (parsed.length === 0) {
          suspectedShellUsage = true;

          return;
        }

        parsed.forEach(visit);
      }

      return;
    }

    const name = shellRecordName(entry);
    const hasShellName = Array.from(SHELL_TOOL_NAMES).some((toolName) => name.includes(toolName));

    if (hasShellName) {
      suspectedShellUsage = true;
      const command = commandFromShellRecord(entry);

      if (command) {
        commands.push(command);
      }
    }
    for (const [key, nested] of Object.entries(entry)) {
      if (["args", "binary", "prompt"].includes(key)) {
        continue;
      }
      visit(nested);
    }
  };

  visit(value);

  return { commands, suspectedShellUsage };
}

function commandPolicyGate(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  worktreePath: string;
  rawLogsRef: string | null;
  commandPolicy?: unknown;
  approved?: boolean;
}): GateResult {
  if (!params.rawLogsRef) {
    return GateResultSchema.parse({
      gateId: "gate_command_policy",
      gateType: GateTypes.CommandPolicy,
      status: ContractValues.Pass,
      evidenceRefs: [],
      reason: "No runner command log was produced",
    });
  }
  const logPath = resolveRunArtifactPath(params.runId, params.rawLogsRef, params.cwd);

  if (!existsSync(logPath)) {
    return GateResultSchema.parse({
      gateId: "gate_command_policy",
      gateType: GateTypes.CommandPolicy,
      status: ContractValues.Blocked,
      evidenceRefs: [params.rawLogsRef],
      reason: "Runner command log artifact is missing",
    });
  }
  let payload: unknown;

  try {
    payload = JSON.parse(readFileSync(logPath, "utf-8")) as unknown;
  } catch {
    return GateResultSchema.parse({
      gateId: "gate_command_policy",
      gateType: GateTypes.CommandPolicy,
      status: ContractValues.Blocked,
      evidenceRefs: [params.rawLogsRef],
      reason: "Runner command log artifact is not parseable JSON",
    });
  }
  const { commands, suspectedShellUsage } = collectCommandEvents(payload);

  if (!suspectedShellUsage) {
    return GateResultSchema.parse({
      gateId: "gate_command_policy",
      gateType: GateTypes.CommandPolicy,
      status: ContractValues.Pass,
      evidenceRefs: [params.rawLogsRef],
      reason: "Runner logs contain no shell command events",
    });
  }
  if (commands.length === 0) {
    return GateResultSchema.parse({
      gateId: "gate_command_policy",
      gateType: GateTypes.CommandPolicy,
      status: ContractValues.Blocked,
      evidenceRefs: [params.rawLogsRef],
      reason: "Runner logs indicate shell usage but no parseable command event",
    });
  }
  if (!isSandboxCommandPolicy(params.commandPolicy)) {
    return GateResultSchema.parse({
      gateId: "gate_command_policy",
      gateType: GateTypes.CommandPolicy,
      status: ContractValues.Blocked,
      evidenceRefs: [params.rawLogsRef],
      reason: "Runner used shell commands but no sandbox command policy was available",
    });
  }
  const evaluator = new SandboxCommandPolicyEvaluator();

  for (const command of commands) {
    const decision = evaluator.evaluate({
      command,
      cwd: params.worktreePath,
      runId: params.runId,
      stepId: params.stepId,
      attemptId: params.attemptId,
      worktreePath: params.worktreePath,
      policy: params.commandPolicy,
      approved: params.approved ?? false,
    });

    if (decision.status !== "allow") {
      return GateResultSchema.parse({
        gateId: "gate_command_policy",
        gateType: GateTypes.CommandPolicy,
        status: ContractValues.Blocked,
        evidenceRefs: [params.rawLogsRef],
        reason: `Runner shell command is not policy compliant: ${command.join(" ")} (${decision.reason})`,
      });
    }
  }

  return GateResultSchema.parse({
    gateId: "gate_command_policy",
    gateType: GateTypes.CommandPolicy,
    status: ContractValues.Pass,
    evidenceRefs: [params.rawLogsRef],
    reason: `Runner shell command events are policy compliant (${commands.length})`,
  });
}

export async function coordinateAttemptGates<TCommandPolicy>(params: {
  input: ExecuteStepAttemptInput<TCommandPolicy>;
  runId: string;
  stepId: string;
  attemptId: string;
  runnerGateResult: GateResult;
  runnerStatus: StepRunnerExecutionStatus;
  mutationRequirement: MutationRequirement;
  runnerRawLogsRef: string | null;
  attemptDiff: AttemptDiff | null;
  diffSubject: EvidenceSubject | null;
}): Promise<{ gateResults: GateResult[]; gateResultsRef: string; postRunnerArtifacts: Artifact[] }> {
  const postRunnerGateEvidence = params.input.postRunnerGateExecutor
    ? await params.input.postRunnerGateExecutor({
        diff: params.attemptDiff?.diff ?? null,
        diffHash: params.attemptDiff?.diffHash ?? null,
        startedAt: new Date().toISOString(),
      })
    : { gateResults: [], artifacts: [] };

  const diffGateResults = policyGateResults({
    cwd: params.input.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    attemptDiff: params.attemptDiff,
    requiredGates: params.input.schedulerDecision.requiredGates,
    ...(params.input.policy ? { policy: params.input.policy } : {}),
    ...(params.input.approved !== undefined ? { approved: params.input.approved } : {}),
    ...(params.input.approvedFiles !== undefined ? { approvedFiles: params.input.approvedFiles } : {}),
  });
  const requiredDiffGate = diffRequiredGate({
    runnerStatus: params.runnerStatus,
    mutationRequirement: params.mutationRequirement,
    attemptDiff: params.attemptDiff,
  });
  const runnerCommandPolicyGate = commandPolicyGate({
    cwd: params.input.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    worktreePath: params.input.worktreePath,
    rawLogsRef: params.runnerRawLogsRef,
    commandPolicy: params.input.commandPolicy,
    ...(params.input.approved !== undefined ? { approved: params.input.approved } : {}),
  });
  auditDiffGatesExecuted({
    cwd: params.input.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    diffHash: params.attemptDiff?.diffHash ?? null,
    gateResults: diffGateResults,
  });

  const gateResults = [
    bindGateSubject(params.runnerGateResult, params.diffSubject),
    ...(params.input.additionalGateResults ?? []).map((entry) => GateResultSchema.parse(entry)),
    ...postRunnerGateEvidence.gateResults.map((entry) => GateResultSchema.parse(entry)),
    runnerCommandPolicyGate,
    ...(requiredDiffGate ? [requiredDiffGate] : []),
    ...diffGateResults,
  ];
  const gateResultsRef = saveGateResults({
    cwd: params.input.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    gateResults,
  });

  return {
    gateResults,
    gateResultsRef,
    postRunnerArtifacts: postRunnerGateEvidence.artifacts.map((entry) => ArtifactSchema.parse(entry)),
  };
}
