import { ContractValues, GateResult, GateResultSchema, GateStatuses, GateTypes } from "@kiwi/contracts";
import { RunnerExecutionError, RunnerExecutionOutput, RunnerExecutionStatus } from "./adapter.js";

export function zeroModelUsage(): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: 0,
    outputTokens: 0,
  };
}

function createRunnerGateResult(params: {
  gateId: string;
  status: typeof GateStatuses.Fail | typeof GateStatuses.Blocked;
  reason: string;
  evidenceRefs?: string[];
}): GateResult {
  return GateResultSchema.parse({
    gateId: params.gateId,
    gateType: GateTypes.ForbiddenFileChecks,
    status: params.status,
    evidenceRefs: params.evidenceRefs ?? [],
    reason: params.reason,
  });
}

export function createFailedRunnerOutput(params: {
  status: Exclude<RunnerExecutionStatus, typeof ContractValues.Completed>;
  code: string;
  message: string;
  gateStatus?: typeof GateStatuses.Fail | typeof GateStatuses.Blocked;
  gateId?: string;
}): RunnerExecutionOutput {
  const error: RunnerExecutionError = {
    code: params.code,
    message: params.message,
  };

  return {
    status: params.status,
    artifactRefs: [],
    rawLogsRef: null,
    modelUsage: zeroModelUsage(),
    gateResult: createRunnerGateResult({
      gateId: params.gateId ?? "gate_runner_adapter",
      status: params.gateStatus ?? ContractValues.Fail,
      reason: params.message,
    }),
    error,
  };
}
