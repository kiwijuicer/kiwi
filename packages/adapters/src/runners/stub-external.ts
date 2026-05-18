import { ContractValues, RunnerName, RunnerNames } from "@kiwi/contracts";
import { RunnerAdapter, RunnerExecutionInput, RunnerExecutionOutput } from "./adapter";
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
