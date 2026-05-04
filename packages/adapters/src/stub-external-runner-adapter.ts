import { RunnerName } from "@ai-kiwi/contracts";
import {
  RunnerAdapter,
  RunnerExecutionInput,
  RunnerExecutionOutput,
} from "./runner-adapter";
import { createFailedRunnerOutput } from "./runner-output";

export type ExternalRunnerName = Exclude<RunnerName, "local-shell">;

export class StubExternalRunnerAdapter implements RunnerAdapter {
  readonly name: ExternalRunnerName;

  constructor(name: ExternalRunnerName) {
    this.name = name;
  }

  async execute(_input: RunnerExecutionInput): Promise<RunnerExecutionOutput> {
    return createFailedRunnerOutput({
      status: "failed",
      code: "RUNNER_NOT_IMPLEMENTED",
      message: `external runner ${this.name} is not configured`,
    });
  }
}
