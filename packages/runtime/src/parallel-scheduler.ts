import { ContractValues, Step, SubPlan, TaskGraph } from "@kiwi/contracts";
import { getRunStatusSummary, latestAttemptByStep, listStepAttemptEvidence, loadTaskGraph } from "@kiwi/core";

export interface RunScheduledSubPlansParams<TAttemptOptions extends object = Record<string, never>> {
  cwd: string;
  runId: string;
  fromStep?: string;
  maxGlobalConcurrency?: number;
  attemptOptions?: TAttemptOptions;
  now?: Date;
  runStep: (runId: string, stepId: string, options: TAttemptOptions & { attemptId: string }) => Promise<unknown>;
}

export interface RunScheduledSubPlansResult {
  attemptedStepIds: string[];
  stoppedStatus?: string;
  stoppedStepId?: string;
}

interface ActiveSubPlan {
  subPlanId: string;
  dependsOn: string[];
  maxConcurrency: number;
  pendingStepIds: string[];
  runningStepIds: Set<string>;
  done: boolean;
}

class Semaphore {
  private permits: number;

  constructor(permits: number) {
    this.permits = permits;
  }

  tryAcquire(): (() => void) | null {
    if (this.permits <= 0) return null;
    this.permits -= 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.permits += 1;
    };
  }
}

function normalizeConcurrency(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`max concurrency must be a positive integer; received ${value}`);
  }
  return value;
}

function defaultSubPlans(taskGraph: TaskGraph): SubPlan[] {
  return [
    {
      subPlanId: "subplan_1",
      title: "Sequential subplan",
      stepIds: taskGraph.steps.map((step) => step.stepId),
      dependsOn: [],
      maxConcurrency: 1,
    },
  ];
}

function selectedStepIds(taskGraph: TaskGraph, fromStep?: string): Set<string> {
  if (!fromStep) return new Set(taskGraph.steps.map((step) => step.stepId));
  const startIndex = taskGraph.steps.findIndex((step) => step.stepId === fromStep);
  if (startIndex < 0) throw new Error(`Step not found: ${fromStep}`);
  return new Set(taskGraph.steps.slice(startIndex).map((step) => step.stepId));
}

function historicalCompletedStepIds(cwd: string, runId: string): Set<string> {
  const attempts = listStepAttemptEvidence(cwd, runId);
  const latest = latestAttemptByStep(attempts);
  const completed = new Set<string>();
  for (const [stepId, evidence] of latest.entries()) {
    if (evidence.attempt.status === ContractValues.Completed) {
      completed.add(stepId);
    }
  }
  return completed;
}

function stepDependenciesSatisfied(params: {
  step: Step;
  selectedStepIdSet: Set<string>;
  completedThisRun: Set<string>;
  completedHistorically: Set<string>;
}): boolean {
  for (const dependencyStepId of params.step.dependsOn) {
    if (params.selectedStepIdSet.has(dependencyStepId)) {
      if (!params.completedThisRun.has(dependencyStepId)) return false;
      continue;
    }
    if (!params.completedHistorically.has(dependencyStepId)) return false;
  }
  return true;
}

function subPlanDependenciesSatisfied(subPlan: ActiveSubPlan, byId: Map<string, ActiveSubPlan>): boolean {
  return subPlan.dependsOn.every((dependencyId) => {
    const dependency = byId.get(dependencyId);
    return dependency ? dependency.done : true;
  });
}

function nextReadyStepId(params: {
  subPlan: ActiveSubPlan;
  stepsById: Map<string, Step>;
  selectedStepIdSet: Set<string>;
  completedThisRun: Set<string>;
  completedHistorically: Set<string>;
}): string | null {
  for (const stepId of params.subPlan.pendingStepIds) {
    if (params.subPlan.runningStepIds.has(stepId)) continue;
    const step = params.stepsById.get(stepId);
    if (!step) continue;
    if (
      stepDependenciesSatisfied({
        step,
        selectedStepIdSet: params.selectedStepIdSet,
        completedThisRun: params.completedThisRun,
        completedHistorically: params.completedHistorically,
      })
    ) {
      return stepId;
    }
  }
  return null;
}

function nextAttemptId(stepId: string, counter: number, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 17);
  return `attempt_${stepId}_${stamp}_${String(counter).padStart(3, "0")}`;
}

function prepareSubPlans(taskGraph: TaskGraph, selected: Set<string>): ActiveSubPlan[] {
  const stepOrder = new Map(taskGraph.steps.map((step, index) => [step.stepId, index]));
  const source = taskGraph.subPlans && taskGraph.subPlans.length > 0 ? taskGraph.subPlans : defaultSubPlans(taskGraph);
  const active: ActiveSubPlan[] = [];
  const assigned = new Set<string>();

  for (const subPlan of source) {
    const filteredStepIds = subPlan.stepIds
      .filter((stepId) => selected.has(stepId))
      .sort((a, b) => (stepOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (stepOrder.get(b) ?? Number.MAX_SAFE_INTEGER));
    if (filteredStepIds.length === 0) continue;
    for (const stepId of filteredStepIds) {
      if (!stepOrder.has(stepId)) {
        throw new Error(`TaskGraph subplan ${subPlan.subPlanId} references unknown stepId ${stepId}`);
      }
      if (assigned.has(stepId)) {
        throw new Error(`TaskGraph subplan assignment is ambiguous for stepId ${stepId}`);
      }
      assigned.add(stepId);
    }
    active.push({
      subPlanId: subPlan.subPlanId,
      dependsOn: subPlan.dependsOn,
      maxConcurrency: normalizeConcurrency(subPlan.maxConcurrency, 1),
      pendingStepIds: filteredStepIds,
      runningStepIds: new Set<string>(),
      done: false,
    });
  }

  const missing = Array.from(selected).filter((stepId) => !assigned.has(stepId));
  if (missing.length > 0) {
    throw new Error(`TaskGraph subplans are missing steps: ${missing.sort().join(", ")}`);
  }

  return active;
}

function pendingStepIds(subPlans: ActiveSubPlan[]): string[] {
  return subPlans.flatMap((subPlan) => subPlan.pendingStepIds);
}

interface SchedulerState<TAttemptOptions extends object> {
  params: RunScheduledSubPlansParams<TAttemptOptions>;
  selectedStepIdSet: Set<string>;
  stepsById: Map<string, Step>;
  completedHistorically: Set<string>;
  completedThisRun: Set<string>;
  subPlans: ActiveSubPlan[];
  subPlansById: Map<string, ActiveSubPlan>;
  semaphore: Semaphore;
  running: Set<Promise<void>>;
  attemptedStepIds: string[];
  baseOptions: TAttemptOptions;
  attemptCounter: number;
  stoppedStatus: string | undefined;
  stoppedStepId: string | undefined;
  firstError: unknown;
}

function removePendingStep(subPlan: ActiveSubPlan, stepId: string): void {
  const index = subPlan.pendingStepIds.indexOf(stepId);
  if (index >= 0) subPlan.pendingStepIds.splice(index, 1);
}

function markSubPlanDoneIfComplete(subPlan: ActiveSubPlan): void {
  if (subPlan.pendingStepIds.length === 0 && subPlan.runningStepIds.size === 0) {
    subPlan.done = true;
  }
}

function updateStoppedStatus<TAttemptOptions extends object>(
  state: SchedulerState<TAttemptOptions>,
  stepId: string,
): void {
  const status = getRunStatusSummary(state.params.cwd, state.params.runId).latest[0]?.currentStatus;
  if ((status === ContractValues.Failed || status === "needs_approval") && state.stoppedStatus === undefined) {
    state.stoppedStatus = status;
    state.stoppedStepId = stepId;
  }
}

function tryStartStep<TAttemptOptions extends object>(
  state: SchedulerState<TAttemptOptions>,
  subPlan: ActiveSubPlan,
  stepId: string,
): boolean {
  const release = state.semaphore.tryAcquire();
  if (!release) return false;

  removePendingStep(subPlan, stepId);
  subPlan.runningStepIds.add(stepId);
  state.attemptedStepIds.push(stepId);

  const attemptId = nextAttemptId(stepId, ++state.attemptCounter, state.params.now ?? new Date());
  const stepOptions = {
    ...state.baseOptions,
    attemptId,
  } as TAttemptOptions & { attemptId: string };

  const task = (async () => {
    try {
      await state.params.runStep(state.params.runId, stepId, stepOptions);
      state.completedThisRun.add(stepId);
      updateStoppedStatus(state, stepId);
    } catch (error) {
      if (state.firstError === undefined) state.firstError = error;
    } finally {
      subPlan.runningStepIds.delete(stepId);
      markSubPlanDoneIfComplete(subPlan);
      release();
    }
  })();

  state.running.add(task);
  void task.finally(() => state.running.delete(task));
  return true;
}

function scheduleSubPlan<TAttemptOptions extends object>(
  state: SchedulerState<TAttemptOptions>,
  subPlan: ActiveSubPlan,
): boolean {
  if (!subPlanDependenciesSatisfied(subPlan, state.subPlansById)) return false;

  let startedAny = false;
  while (subPlan.runningStepIds.size < subPlan.maxConcurrency) {
    const readyStepId = nextReadyStepId({
      subPlan,
      stepsById: state.stepsById,
      selectedStepIdSet: state.selectedStepIdSet,
      completedThisRun: state.completedThisRun,
      completedHistorically: state.completedHistorically,
    });
    if (!readyStepId) break;
    if (!tryStartStep(state, subPlan, readyStepId)) break;
    startedAny = true;
  }
  return startedAny;
}

function scheduleReadySubPlans<TAttemptOptions extends object>(state: SchedulerState<TAttemptOptions>): boolean {
  let startedAny = false;
  for (const subPlan of state.subPlans) {
    startedAny = scheduleSubPlan(state, subPlan) || startedAny;
  }
  return startedAny;
}

export async function runScheduledSubPlans<TAttemptOptions extends object = Record<string, never>>(
  params: RunScheduledSubPlansParams<TAttemptOptions>,
): Promise<RunScheduledSubPlansResult> {
  const taskGraph = loadTaskGraph(params.runId, params.cwd);
  const selectedStepIdSet = selectedStepIds(taskGraph, params.fromStep);
  const subPlans = prepareSubPlans(taskGraph, selectedStepIdSet);
  const state: SchedulerState<TAttemptOptions> = {
    params,
    selectedStepIdSet,
    stepsById: new Map(taskGraph.steps.map((step) => [step.stepId, step])),
    completedHistorically: historicalCompletedStepIds(params.cwd, params.runId),
    completedThisRun: new Set<string>(),
    subPlans,
    subPlansById: new Map(subPlans.map((subPlan) => [subPlan.subPlanId, subPlan])),
    semaphore: new Semaphore(normalizeConcurrency(params.maxGlobalConcurrency, 2)),
    running: new Set<Promise<void>>(),
    attemptedStepIds: [],
    baseOptions: (params.attemptOptions ?? {}) as TAttemptOptions,
    attemptCounter: 0,
    stoppedStatus: undefined,
    stoppedStepId: undefined,
    firstError: undefined,
  };

  while (state.running.size > 0 || pendingStepIds(state.subPlans).length > 0) {
    const startedAny =
      state.stoppedStatus === undefined && state.firstError === undefined ? scheduleReadySubPlans(state) : false;

    const pending = pendingStepIds(state.subPlans);
    if (state.running.size === 0) {
      if (pending.length === 0 || state.stoppedStatus !== undefined || state.firstError !== undefined) break;
      if (!startedAny) throw new Error(`Subplan scheduling deadlock; remaining steps: ${pending.join(", ")}`);
    }

    if (state.running.size > 0) await Promise.race(Array.from(state.running));
  }

  if (state.firstError !== undefined) {
    throw state.firstError;
  }

  return {
    attemptedStepIds: state.attemptedStepIds,
    ...(state.stoppedStatus ? { stoppedStatus: state.stoppedStatus } : {}),
    ...(state.stoppedStepId ? { stoppedStepId: state.stoppedStepId } : {}),
  };
}
