import type { CoreServices } from "@kiwi/core";
import type { Initiative, KiwiPolicy, ModelRegistry, Step, TaskGraph } from "@kiwi/contracts";
import type { ExecutePlannedStepInput } from "./types.js";

export class ExecutionRunContext {
  readonly repoPath: string;

  constructor(
    readonly cwd: string,
    readonly runId: string,
    readonly now: Date,
    readonly policy: KiwiPolicy,
    readonly registry: ModelRegistry,
    readonly initiative: Initiative,
    readonly taskGraph: TaskGraph,
  ) {
    this.repoPath = initiative.repoPath || cwd;
  }

  step(stepId: string): Step {
    const step = this.taskGraph.steps.find((entry) => entry.stepId === stepId);

    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    return step;
  }
}

export class ExecutionContextLoader {
  constructor(
    private readonly core: CoreServices,
    private readonly env?: Record<string, string | undefined>,
  ) {}

  load(input: Pick<ExecutePlannedStepInput, "cwd" | "runId" | "now">): ExecutionRunContext {
    return new ExecutionRunContext(
      input.cwd,
      input.runId,
      input.now ?? new Date(),
      this.core.config.loadEffectivePolicy(input.cwd, this.env ? { env: this.env } : undefined),
      this.core.config.loadEffectiveRegistry(input.cwd, this.env ? { env: this.env } : undefined),
      this.core.runs.loadInitiative(input.runId, input.cwd),
      this.core.runs.loadTaskGraph(input.runId, input.cwd),
    );
  }

  assertStepReady(context: ExecutionRunContext, step: Step): void {
    this.core.evidence.assertStepDependenciesCompleted({
      cwd: context.cwd,
      runId: context.runId,
      stepId: step.stepId,
      dependsOn: step.dependsOn,
    });
  }
}
