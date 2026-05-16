import {
  assertStepDependenciesCompleted,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  loadInitiative,
  loadPolicy,
  loadRegistry,
  loadTaskGraph,
} from "@kiwi/core";
import type { Initiative, KiwiPolicy, ModelRegistry, Step, TaskGraph } from "@kiwi/contracts";
import type { ExecutePlannedStepInput } from "./types";

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

  assertStepReady(step: Step): void {
    assertStepDependenciesCompleted({
      cwd: this.cwd,
      runId: this.runId,
      stepId: step.stepId,
      dependsOn: step.dependsOn,
    });
  }
}

export class ExecutionContextLoader {
  load(input: Pick<ExecutePlannedStepInput, "cwd" | "runId" | "now">): ExecutionRunContext {
    return new ExecutionRunContext(
      input.cwd,
      input.runId,
      input.now ?? new Date(),
      loadPolicy(kiwiPolicyPath(input.cwd)),
      loadRegistry(kiwiModelRegistryPath(input.cwd)),
      loadInitiative(input.runId, input.cwd),
      loadTaskGraph(input.runId, input.cwd),
    );
  }
}
