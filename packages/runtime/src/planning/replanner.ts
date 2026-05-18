import { existsSync, readdirSync } from "fs";
import path from "path";
import { ContractValues, ReviewVerdict, StepSchema, TaskGraph, TaskGraphSchema } from "@kiwi/contracts";
import { appendAuditEvent, generateStepId, loadTaskGraph, resolveRunArtifactPath, writeJsonSafely } from "@kiwi/core";

export interface ReplannerInput {
  cwd: string;
  runId: string;
  focalStepId: string;
  reviewVerdict: ReviewVerdict;
  now?: Date;
}

export interface InjectFixStepResult {
  injectedStepId: string;
  taskGraphPath: string;
}

export interface AttemptReplanResult {
  taskGraphPath: string;
  version: number;
}

function nextFixStepId(taskGraph: TaskGraph): string {
  const maxNum = taskGraph.steps.reduce((max, s) => {
    const m = s.stepId.match(/^step_(\d{3})$/);

    return m ? Math.max(max, parseInt(m[1]!, 10)) : max;
  }, 0);

  return generateStepId(maxNum); // generateStepId(n) → step_(n+1)
}

function nextReplanVersion(cwd: string, runId: string): number {
  const planDir = path.dirname(resolveRunArtifactPath(runId, "plan/task-graph.json", cwd));

  if (!existsSync(planDir)) {
    return 2;
  }
  const versions = readdirSync(planDir)
    .map((f) => f.match(/^task-graph\.v(\d+)\.json$/))
    .filter(Boolean)
    .map((m) => parseInt(m![1]!, 10));

  return versions.length === 0 ? 2 : Math.max(...versions) + 1;
}

/**
 * Inject a `code_modification` fix step immediately after the focal (failed) step and
 * overwrite `plan/task-graph.json` in place.  Emits a `fix_step_injected` audit event.
 */
export function injectFixStep(input: ReplannerInput): InjectFixStepResult {
  const taskGraph = loadTaskGraph(input.runId, input.cwd);
  const focalIndex = taskGraph.steps.findIndex((s) => s.stepId === input.focalStepId);

  if (focalIndex < 0) {
    throw new Error(`Step not found in task graph: ${input.focalStepId}`);
  }

  const focalStep = taskGraph.steps[focalIndex]!;
  const newStepId = nextFixStepId(taskGraph);

  const fixStep = StepSchema.parse({
    stepId: newStepId,
    type: "code_modification",
    title: `Fix: ${focalStep.title}`,
    dependsOn: [input.focalStepId],
    successCriteria:
      input.reviewVerdict.recommendedNextSteps.length > 0
        ? input.reviewVerdict.recommendedNextSteps
        : ["Fix issues identified in review"],
    requiredGates: [],
    recommendedAgentRole: ContractValues.Executor,
    recommendedModelCapability: ContractValues.Strong,
    status: ContractValues.Pending,
  });

  const newSteps = [...taskGraph.steps.slice(0, focalIndex + 1), fixStep, ...taskGraph.steps.slice(focalIndex + 1)];

  const updatedTaskGraph = TaskGraphSchema.parse({ ...taskGraph, steps: newSteps });
  const target = resolveRunArtifactPath(input.runId, "plan/task-graph.json", input.cwd);
  writeJsonSafely(target, updatedTaskGraph);

  const now = (input.now ?? new Date()).toISOString();
  appendAuditEvent(input.cwd, {
    eventType: "fix_step_injected",
    runId: input.runId,
    timestamp: now,
    payload: {
      focalStepId: input.focalStepId,
      injectedStepId: newStepId,
      verdict: input.reviewVerdict.verdict,
      issueCodes: input.reviewVerdict.issues.map((i) => i.code),
      recommendedNextSteps: input.reviewVerdict.recommendedNextSteps,
    },
  });

  return { injectedStepId: newStepId, taskGraphPath: "plan/task-graph.json" };
}

/**
 * Write a versioned `plan/task-graph.vN.json` alongside the original.  The CLI's
 * `loadTaskGraph` will prefer the highest-version file on subsequent runs.
 * Emits `replan_succeeded` (or `replan_failed`) audit events.
 */
export function attemptReplan(input: ReplannerInput): AttemptReplanResult {
  const taskGraph = loadTaskGraph(input.runId, input.cwd);
  const now = (input.now ?? new Date()).toISOString();
  const version = nextReplanVersion(input.cwd, input.runId);
  const versionedPath = `plan/task-graph.v${version}.json`;

  try {
    const issuesSummary = input.reviewVerdict.issues.map((i) => i.title).join("; ") || "see review verdict";
    const replanNote = `Replanned v${version}: focal step ${input.focalStepId} rejected — ${issuesSummary}`;

    const updatedTaskGraph = TaskGraphSchema.parse({
      ...taskGraph,
      summary: `[${replanNote}] ${taskGraph.summary}`,
      openQuestions: [...taskGraph.openQuestions, ...input.reviewVerdict.recommendedNextSteps],
    });

    const target = resolveRunArtifactPath(input.runId, versionedPath, input.cwd);
    writeJsonSafely(target, updatedTaskGraph);

    appendAuditEvent(input.cwd, {
      eventType: "replan_succeeded",
      runId: input.runId,
      timestamp: now,
      payload: {
        focalStepId: input.focalStepId,
        version,
        taskGraphPath: versionedPath,
        verdict: input.reviewVerdict.verdict,
        issueCodes: input.reviewVerdict.issues.map((i) => i.code),
        recommendedNextSteps: input.reviewVerdict.recommendedNextSteps,
      },
    });

    return { taskGraphPath: versionedPath, version };
  } catch (error) {
    appendAuditEvent(input.cwd, {
      eventType: "replan_failed",
      runId: input.runId,
      timestamp: now,
      payload: {
        focalStepId: input.focalStepId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
