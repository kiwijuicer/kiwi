import { TaskGraph } from "@kiwi/contracts";
import { PlannerProvider, PlannerProviderInput, PlannerProviderOutput } from "./planner";

export type DeterministicTaskGraphBuilder = (params: {
  runId: string;
  initiative: PlannerProviderInput["initiative"];
  policy: PlannerProviderInput["policy"];
  now?: Date;
  planIdSuffix?: string;
}) => TaskGraph;

export interface StubPlannerProviderOptions {
  buildTaskGraph: DeterministicTaskGraphBuilder;
  now?: () => Date;
  planIdSuffix?: string;
}

export class StubPlannerProvider implements PlannerProvider {
  readonly name = "stub-deterministic";

  constructor(private readonly options: StubPlannerProviderOptions) {}

  async plan(input: PlannerProviderInput): Promise<PlannerProviderOutput> {
    const now = this.options.now?.() ?? new Date(input.requestedAt);
    const buildParams = this.options.planIdSuffix
      ? {
          runId: input.runId,
          initiative: input.initiative,
          policy: input.policy,
          now,
          planIdSuffix: this.options.planIdSuffix,
        }
      : {
          runId: input.runId,
          initiative: input.initiative,
          policy: input.policy,
          now,
        };
    const taskGraph = this.options.buildTaskGraph({
      ...buildParams,
    });

    return {
      providerName: this.name,
      taskGraph,
      modelUsage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      cost: {
        estimatedUsd: 0,
        currency: "USD",
      },
    };
  }
}
