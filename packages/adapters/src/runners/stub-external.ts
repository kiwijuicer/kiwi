import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { Artifact, ContractValues, GateResultSchema, RunnerName, RunnerNames } from "@kiwi/contracts";
import { RunnerAdapter, RunnerExecutionInput, RunnerExecutionOutput } from "./adapter";
import { captureRunnerDiffArtifact } from "./diff-artifact";
import { createFailedRunnerOutput } from "./output";

export type ExternalRunnerName = Exclude<RunnerName, typeof RunnerNames.LocalShell>;

export class StubExternalRunnerAdapter implements RunnerAdapter {
  readonly name: ExternalRunnerName;

  constructor(name: ExternalRunnerName) {
    this.name = name;
  }

  async execute(_input: RunnerExecutionInput): Promise<RunnerExecutionOutput> {
    return createFailedRunnerOutput({
      status: ContractValues.Failed,
      code: "RUNNER_NOT_IMPLEMENTED",
      message: `external runner ${this.name} is not configured`,
    });
  }
}

export class StubRunnerAdapter implements RunnerAdapter {
  readonly name: RunnerName = RunnerNames.Stub;

  async execute(input: RunnerExecutionInput): Promise<RunnerExecutionOutput> {
    mkdirSync(input.worktreePath, { recursive: true });
    const outputRef = `steps/${input.stepId}/${input.attemptId}/artifacts/stub-runner-output.json`;
    const outputTarget = path.join(input.workspacePath, ".kiwi", "runs", input.runId, outputRef);
    mkdirSync(path.dirname(outputTarget), { recursive: true });

    const mutation = input.contextPackage.mutationRequirement;
    if (mutation === "must_change_files") {
      const target = path.join(input.worktreePath, "kiwi-stub-output", `${input.stepId}.txt`);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `${input.step.title}\n${input.step.successCriteria.join("\n")}\n`, "utf-8");
    }

    writeFileSync(
      outputTarget,
      JSON.stringify(
        {
          runner: this.name,
          step: input.step,
          mutationRequirement: mutation,
          status: ContractValues.Completed,
        },
        null,
        2,
      ),
      "utf-8",
    );
    const outputArtifact: Artifact = {
      type: "command_output",
      ref: outputRef,
      createdAt: input.requestedAt ?? new Date().toISOString(),
    };
    const diffArtifact = captureRunnerDiffArtifact(input);

    return {
      status: ContractValues.Completed,
      artifactRefs: diffArtifact ? [outputArtifact, diffArtifact] : [outputArtifact],
      rawLogsRef: outputRef,
      modelUsage: { inputTokens: 0, outputTokens: 0 },
      modelId: "stub-runner",
      providerName: "stub",
      accessMode: "stub",
      usagePrecision: "exact",
      estimatedCostUsd: 0,
      gateResult: GateResultSchema.parse({
        gateId: "gate_runner_execution",
        gateType: "command_policy",
        status: ContractValues.Pass,
        evidenceRefs: [outputRef],
        reason: "stub runner completed",
      }),
    };
  }
}
