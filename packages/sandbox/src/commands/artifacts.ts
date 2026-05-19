import {
  Artifact,
  ArtifactTypes,
  ContractValues,
  GateResult,
  GateResultSchema,
  RunnerExecutionStatuses,
} from "@kiwi/contracts";
import { appendAuditEvent, resolveRunArtifactPath, writeJsonSafely } from "../shared/common.js";
import type { PolicyDecision } from "./policy.js";
import type { SandboxCommandInput, SandboxCommandOutput, SandboxExecutionStatus } from "./types.js";
import { SandboxPolicyDecisionStatuses } from "../constants.js";

function redact(value: string, secretValues: string[]): string {
  return secretValues
    .filter((secret) => secret.length > 0)
    .reduce((current, secret) => current.split(secret).join("[REDACTED]"), value);
}

function gateResult(params: {
  gateId?: string;
  gateType?: SandboxCommandInput["gateType"];
  status: typeof ContractValues.Pass | typeof ContractValues.Fail | typeof ContractValues.Blocked;
  reason: string;
  evidenceRefs: string[];
}): GateResult {
  return GateResultSchema.parse({
    gateId: params.gateId ?? "gate_command_execution",
    gateType: params.gateType ?? "forbidden_file_checks",
    status: params.status,
    evidenceRefs: params.evidenceRefs,
    reason: params.reason,
  });
}

function artifactRef(ref: string, createdAt: string): Artifact {
  return {
    type: ArtifactTypes.CommandOutput,
    ref,
    createdAt,
  };
}

function persistOutput(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  payload: unknown;
  artifactLabel?: string;
}): string {
  const suffix = params.artifactLabel ? `-${params.artifactLabel.replace(/[^a-z0-9_-]/gi, "_")}` : "";
  const relativePath = `steps/${params.stepId}/${params.attemptId}/artifacts/command-output${suffix}.json`;
  const target = resolveRunArtifactPath(params.cwd, params.runId, relativePath);
  writeJsonSafely(target, params.payload);

  return relativePath;
}

export function auditPolicyDecision(
  input: SandboxCommandInput,
  startedAt: string,
  policyDecision: PolicyDecision,
): void {
  appendAuditEvent(input.cwd, {
    eventType:
      policyDecision.status === SandboxPolicyDecisionStatuses.Allow
        ? "sandbox_command_allowed"
        : "sandbox_command_blocked",
    runId: input.runId,
    timestamp: startedAt,
    payload: {
      stepId: input.stepId,
      attemptId: input.attemptId,
      command: input.command,
      status: policyDecision.status,
      reason: policyDecision.reason,
    },
  });
}

export function blockedOutput(
  input: SandboxCommandInput,
  startedAt: string,
  policyDecision: {
    status: typeof ContractValues.Blocked | typeof RunnerExecutionStatuses.ApprovalRequired;
    reason: string;
  },
): SandboxCommandOutput {
  const completedAt = new Date().toISOString();
  const blockedGateParams: Parameters<typeof gateResult>[0] = {
    status: ContractValues.Blocked,
    reason: policyDecision.reason,
    evidenceRefs: [],
  };

  if (input.gateId) {
    blockedGateParams.gateId = input.gateId;
  }
  if (input.gateType) {
    blockedGateParams.gateType = input.gateType;
  }

  return {
    status: policyDecision.status,
    exitCode: null,
    stdout: "",
    stderr: policyDecision.reason,
    artifactRefs: [],
    gateResult: gateResult(blockedGateParams),
    startedAt,
    completedAt,
  };
}

function resolveStatus(timedOut: boolean, exitCode: number | null): SandboxExecutionStatus {
  if (timedOut) {
    return RunnerExecutionStatuses.Timeout;
  }

  return exitCode === 0 ? ContractValues.Completed : ContractValues.Failed;
}

function gateReason(status: SandboxExecutionStatus): string {
  if (status === ContractValues.Completed) {
    return "Command completed successfully";
  }
  if (status === RunnerExecutionStatuses.Timeout) {
    return "Command timed out";
  }

  return "Command failed";
}

export function finishCommand(params: {
  input: SandboxCommandInput;
  startedAt: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}): SandboxCommandOutput {
  const { input, startedAt, exitCode, timedOut } = params;
  const completedAt = new Date().toISOString();
  const redactedStdout = redact(params.stdout, input.policy.secretValues);
  const redactedStderr = redact(params.stderr, input.policy.secretValues);
  const status = resolveStatus(timedOut, exitCode);
  const outputRef = persistOutput({
    cwd: input.cwd,
    runId: input.runId,
    stepId: input.stepId,
    attemptId: input.attemptId,
    ...(input.artifactLabel ? { artifactLabel: input.artifactLabel } : {}),
    payload: {
      command: input.command,
      status,
      exitCode,
      stdout: redactedStdout,
      stderr: redactedStderr,
      startedAt,
      completedAt,
    },
  });
  const gateParams: Parameters<typeof gateResult>[0] = {
    status: status === ContractValues.Completed ? ContractValues.Pass : ContractValues.Fail,
    reason: gateReason(status),
    evidenceRefs: [outputRef],
  };

  if (input.gateId) {
    gateParams.gateId = input.gateId;
  }
  if (input.gateType) {
    gateParams.gateType = input.gateType;
  }

  appendAuditEvent(input.cwd, {
    eventType: status === RunnerExecutionStatuses.Timeout ? "sandbox_command_timeout" : "sandbox_command_completed",
    runId: input.runId,
    timestamp: completedAt,
    payload: {
      stepId: input.stepId,
      attemptId: input.attemptId,
      status,
      exitCode,
      artifactRefs: [outputRef],
    },
  });

  return {
    status,
    exitCode,
    stdout: redactedStdout,
    stderr: redactedStderr,
    artifactRefs: [artifactRef(outputRef, completedAt)],
    gateResult: gateResult(gateParams),
    startedAt,
    completedAt,
  };
}
