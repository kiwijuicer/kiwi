import { existsSync, readdirSync } from "fs";
import path from "path";
import { runPlannerProviderWithRetries, type PlannerProviderInput, type PlannerReplanContext } from "@kiwi/adapters";
import {
  ContractValues,
  ModelInvocationRecord,
  ReviewVerdict,
  RunFeedback,
  RunStatuses,
  StepSchema,
  TaskGraph,
  TaskGraphSchema,
} from "@kiwi/contracts";
import {
  appendAuditEvent,
  appendModelInvocation,
  generateStepId,
  listRunFeedback,
  listStepAttemptEvidence,
  loadEffectivePolicy,
  loadEffectiveRegistry,
  loadInitiative,
  loadTaskGraph,
  recordRunFeedback,
  resolveRunArtifactPath,
  updateRunPlanStatus,
  writeJsonSafely,
} from "@kiwi/core";
import { buildRunDiff } from "../execution/diff-workflow.js";
import { resolvePlannerProvider } from "./planner-resolution.js";

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

export interface FeedbackReplanInput {
  cwd: string;
  runId: string;
  message: string;
  source: RunFeedback["source"];
  author?: string;
  targetStepId?: string;
  targetAttemptId?: string;
  now?: Date;
  env?: Record<string, string | undefined>;
}

export interface FeedbackReplanResult {
  runId: string;
  feedbackRef: string;
  taskGraphPath: string;
  version: number;
  planId: string;
  resumeFromStepId?: string;
  modelInvocationRef?: string;
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

function problemAttemptRefs(input: FeedbackReplanInput): string[] {
  const attempts = listStepAttemptEvidence(input.cwd, input.runId);
  const selected = attempts.filter((entry) => {
    if (input.targetAttemptId && entry.attemptId !== input.targetAttemptId) {
      return false;
    }
    if (input.targetStepId && entry.stepId !== input.targetStepId) {
      return false;
    }

    return (
      entry.attempt.status === ContractValues.Failed ||
      entry.attempt.status === ContractValues.Blocked ||
      entry.reviewVerdict?.safeToContinue === false
    );
  });

  return selected.flatMap((entry) =>
    [entry.reviewReportRef, entry.gateResultsRef, entry.summaryRef, entry.schedulerDecisionRef].filter(
      (ref): ref is string => Boolean(ref),
    ),
  );
}

function latestProblemAttempts(input: FeedbackReplanInput): PlannerReplanContext["latestProblemAttempts"] {
  return listStepAttemptEvidence(input.cwd, input.runId)
    .filter((entry) => {
      if (input.targetAttemptId && entry.attemptId !== input.targetAttemptId) {
        return false;
      }
      if (input.targetStepId && entry.stepId !== input.targetStepId) {
        return false;
      }

      return (
        entry.attempt.status === ContractValues.Failed ||
        entry.attempt.status === ContractValues.Blocked ||
        entry.reviewVerdict?.safeToContinue === false
      );
    })
    .map((entry) => ({
      stepId: entry.stepId,
      attemptId: entry.attemptId,
      status: entry.attempt.status,
      ...(entry.reviewVerdict ? { reviewVerdict: entry.reviewVerdict } : {}),
      gateResults: entry.gateResults,
      artifactRefs: entry.attempt.artifacts.map((artifact) => artifact.ref),
    }));
}

function resumeFromStepId(input: FeedbackReplanInput): string | undefined {
  if (input.targetStepId) {
    return input.targetStepId;
  }

  return latestProblemAttempts(input)[0]?.stepId;
}

function diffFiles(patch: string): string[] {
  const files = new Set<string>();

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++ b/") || line.startsWith("--- a/")) {
      files.add(line.slice(6));
    }
  }

  return Array.from(files).sort();
}

function diffSummaries(cwd: string, runId: string): PlannerReplanContext["diffSummaries"] {
  return buildRunDiff({ cwd, runId }).items.map((item) => ({
    stepId: item.stepId,
    attemptId: item.attemptId,
    diffRef: item.diffRef,
    stat: item.stat,
    files: diffFiles(item.patch),
    reviewVerdict: item.reviewVerdict,
  }));
}

function plannerInvocationRecord(params: {
  cwd: string;
  runId: string;
  plannerModel: ReturnType<typeof resolvePlannerProvider>["model"];
  providerName: string;
  usage: { inputTokens: number; outputTokens: number };
  estimatedCostUsd: number;
  status: ModelInvocationRecord["status"];
  evidenceRefs: string[];
  now: Date;
}): string {
  return appendModelInvocation(params.cwd, {
    schemaVersion: "1",
    runId: params.runId,
    phase: ContractValues.Planner,
    agentRole: ContractValues.Planner,
    requestedCapability: params.plannerModel.capability,
    selectedCapability: params.plannerModel.capability,
    modelId: params.plannerModel.id,
    providerName: params.providerName,
    runner: null,
    accessMode: params.plannerModel.accessMode,
    usage: params.usage,
    usagePrecision: "estimated",
    estimatedCostUsd: params.estimatedCostUsd,
    status: params.status,
    evidenceRefs: params.evidenceRefs,
    startedAt: params.now.toISOString(),
    completedAt: params.now.toISOString(),
  });
}

export async function recordFeedbackAndReplan(input: FeedbackReplanInput): Promise<FeedbackReplanResult> {
  const now = input.now ?? new Date();
  const evidenceRefs = problemAttemptRefs(input);
  const feedbackResult = recordRunFeedback({
    cwd: input.cwd,
    runId: input.runId,
    message: input.message,
    source: input.source,
    ...(input.author ? { author: input.author } : {}),
    ...(input.targetStepId ? { targetStepId: input.targetStepId } : {}),
    ...(input.targetAttemptId ? { targetAttemptId: input.targetAttemptId } : {}),
    evidenceRefs,
    now,
  });
  const version = nextReplanVersion(input.cwd, input.runId);
  const versionedPath = `plan/task-graph.v${version}.json`;
  const replanInputRef = `plan/replan-v${version}-input.json`;
  const replanOutputRef = `plan/replan-v${version}-output.json`;
  const replanCostRef = `plan/replan-v${version}-cost-report.json`;
  const policy = loadEffectivePolicy(input.cwd, input.env ? { env: input.env } : undefined);
  const registry = loadEffectiveRegistry(input.cwd, input.env ? { env: input.env } : undefined);
  const resolution = resolvePlannerProvider({
    registryModels: registry.models,
    ...(input.env ? { env: input.env } : {}),
    now: () => now,
    planIdSuffix: `replan_v${version}`,
    preferenceByRole: policy.routing.providerPreference,
  });
  const initiative = loadInitiative(input.runId, input.cwd);
  const currentTaskGraph = loadTaskGraph(input.runId, input.cwd);
  const resumeStepId = resumeFromStepId(input);
  const plannerInput: PlannerProviderInput = {
    runId: input.runId,
    initiative,
    policy,
    requestedAt: now.toISOString(),
    replanContext: {
      request: "Revise the current TaskGraph using human feedback and failed review evidence.",
      currentTaskGraph,
      feedback: feedbackResult.feedback,
      feedbackHistory: listRunFeedback(input.cwd, input.runId),
      latestProblemAttempts: latestProblemAttempts(input),
      diffSummaries: diffSummaries(input.cwd, input.runId),
    },
  };

  writeJsonSafely(resolveRunArtifactPath(input.runId, replanInputRef, input.cwd), plannerInput);
  appendAuditEvent(input.cwd, {
    eventType: "replan_started",
    runId: input.runId,
    timestamp: now.toISOString(),
    payload: {
      version,
      feedbackRef: feedbackResult.ref,
      provider: resolution.provider.name,
      plannerModelId: resolution.model.id,
    },
  });

  try {
    const plannerOutput = await runPlannerProviderWithRetries(resolution.provider, plannerInput, { maxAttempts: 2 });
    const taskGraphInput = { ...plannerOutput.taskGraph, createdAt: now.toISOString() };
    const taskGraph = TaskGraphSchema.parse(taskGraphInput);

    writeJsonSafely(resolveRunArtifactPath(input.runId, versionedPath, input.cwd), taskGraph);
    writeJsonSafely(resolveRunArtifactPath(input.runId, replanOutputRef, input.cwd), {
      plannerModelId: resolution.model.id,
      providerName: plannerOutput.providerName,
      providerModel: resolution.model.providerModel ?? null,
      validation: plannerOutput.validation,
      retry: plannerOutput.retry,
      taskGraph,
      ...(plannerOutput.providerArtifacts?.plannerOutput
        ? { provider: plannerOutput.providerArtifacts.plannerOutput }
        : {}),
    });
    writeJsonSafely(resolveRunArtifactPath(input.runId, replanCostRef, input.cwd), {
      schemaVersion: "1",
      runId: input.runId,
      plannerModelId: resolution.model.id,
      providerName: plannerOutput.providerName,
      budgetProfile: initiative.budgetProfile,
      budgetRemainingUsdEstimate: null,
      attemptsUsed: plannerOutput.retry.attemptsUsed,
      invalidAttempts: plannerOutput.retry.invalidAttempts,
      modelUsage: plannerOutput.modelUsage,
      cost: plannerOutput.cost,
      createdAt: now.toISOString(),
    });
    const modelInvocationRef = plannerInvocationRecord({
      cwd: input.cwd,
      runId: input.runId,
      plannerModel: resolution.model,
      providerName: plannerOutput.providerName,
      usage: plannerOutput.modelUsage,
      estimatedCostUsd: plannerOutput.cost.estimatedUsd,
      status: ContractValues.Completed,
      evidenceRefs: [feedbackResult.ref, replanInputRef, replanOutputRef, replanCostRef],
      now,
    });

    updateRunPlanStatus({
      cwd: input.cwd,
      runId: input.runId,
      planId: taskGraph.planId,
      status: RunStatuses.Planned,
      now,
    });
    appendAuditEvent(input.cwd, {
      eventType: "replan_succeeded",
      runId: input.runId,
      timestamp: now.toISOString(),
      payload: {
        version,
        taskGraphPath: versionedPath,
        feedbackRef: feedbackResult.ref,
        modelInvocationRef,
        plannerModelId: resolution.model.id,
      },
    });

    return {
      runId: input.runId,
      feedbackRef: feedbackResult.ref,
      taskGraphPath: versionedPath,
      version,
      planId: taskGraph.planId,
      ...(resumeStepId ? { resumeFromStepId: resumeStepId } : {}),
      modelInvocationRef,
    };
  } catch (error) {
    plannerInvocationRecord({
      cwd: input.cwd,
      runId: input.runId,
      plannerModel: resolution.model,
      providerName: resolution.provider.name,
      usage: { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd: 0,
      status: ContractValues.Failed,
      evidenceRefs: [feedbackResult.ref, replanInputRef],
      now,
    });
    appendAuditEvent(input.cwd, {
      eventType: "replan_failed",
      runId: input.runId,
      timestamp: now.toISOString(),
      payload: {
        version,
        feedbackRef: feedbackResult.ref,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
