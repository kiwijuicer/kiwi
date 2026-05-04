import { GateResult, GateResultSchema } from "@kiwi/contracts";
import { RunnerExecutionError, RunnerExecutionOutput, RunnerExecutionStatus } from "./runner-adapter";

export function zeroModelUsage(): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: 0,
    outputTokens: 0,
  };
}

function createRunnerGateResult(params: {
  gateId: string;
  status: "fail" | "blocked";
  reason: string;
  evidenceRefs?: string[];
}): GateResult {
  return GateResultSchema.parse({
    gateId: params.gateId,
    gateType: "forbidden_file_checks",
    status: params.status,
    evidenceRefs: params.evidenceRefs ?? [],
    reason: params.reason,
  });
}

export function createFailedRunnerOutput(params: {
  status: Exclude<RunnerExecutionStatus, "completed">;
  code: string;
  message: string;
  gateStatus?: "fail" | "blocked";
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
      status: params.gateStatus ?? "fail",
      reason: params.message,
    }),
    error,
  };
}
