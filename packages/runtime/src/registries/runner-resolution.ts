import { RunnerRegistry, RunnerResolution, RunnerResolutionOptions } from "./runner-registry.js";

export type { RunnerResolution, RunnerResolutionOptions } from "./runner-registry.js";

export function resolveRunner(options: RunnerResolutionOptions): RunnerResolution {
  return new RunnerRegistry().resolve(options);
}

export class RunnerResolver {
  resolve(options: RunnerResolutionOptions): RunnerResolution {
    return resolveRunner(options);
  }
}
