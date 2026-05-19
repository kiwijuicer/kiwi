import {
  PlannerProviderRegistry,
  PlannerResolution,
  ResolvePlannerProviderOptions,
} from "../registries/planner-provider-registry.js";

export type { PlannerResolution, ResolvePlannerProviderOptions } from "../registries/planner-provider-registry.js";

export function resolvePlannerProvider(options: ResolvePlannerProviderOptions): PlannerResolution {
  return new PlannerProviderRegistry().resolve(options);
}
