import { RunnerRegistry, RunnerResolution, RunnerResolutionOptions } from "./runner-registry";

export type { RunnerResolution, RunnerResolutionOptions } from "./runner-registry";

export function resolveRunner(options: RunnerResolutionOptions): RunnerResolution {
  return new RunnerRegistry().resolve(options);
}
