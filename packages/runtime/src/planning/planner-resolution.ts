import { PlannerProviderRegistry, PlannerResolution, ResolvePlannerProviderOptions } from "../registries/planner-provider-registry";

export type { PlannerResolution, ResolvePlannerProviderOptions } from "../registries/planner-provider-registry";

export function resolvePlannerProvider(options: ResolvePlannerProviderOptions): PlannerResolution {
  return new PlannerProviderRegistry().resolve(options);
}
