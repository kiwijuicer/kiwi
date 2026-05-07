import {
  appendAuditEvent,
  assertStepDependenciesCompleted,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  loadApprovalDecision,
  loadInitiative,
  loadPolicy,
  loadRegistry,
  loadTaskGraph,
  remainingBudgetUsdEstimate,
  refreshRunStatusFromAttempts,
} from "@kiwi/core";
import { ArtifactTypes, ContractValues, KiwiPolicy, ModelEntry, RunnerNames } from "@kiwi/contracts";
import {
  applyDiffArtifactToSource,
  createWorktreeSandbox,
  SandboxCommandPolicy,
  teardownWorktreeSandbox,
} from "@kiwi/sandbox";
import { commandProfileForStep, commandProfileToExecutionPolicy, noopCommand } from "./operator-policy";
import { createReviewEngineFromRegistry } from "./provider-review-engine";
import { ResearcherProviderRegistry } from "./researcher-provider-registry";
import { ResearcherStepRunner } from "./researcher-step-runner";
import { resolveRunner } from "./runner-resolution";
import type { ExecutorSelection, RunnerResolution } from "./runner-registry";
import { runRequiredGates } from "./required-gates";
import { scheduleStepAttempt } from "./scheduler-policy";
import type { SchedulerDecision } from "./scheduler-policy";
import { StepAttemptOrchestrator } from "./step-attempt-orchestrator";
import type { StepAttemptRunner } from "./step-runner-types";

export interface ExecutePlannedStepInput {
  cwd: string;
  runId: string;
  stepId: string;
  command?: string[];
  approved?: boolean;
  attemptId?: string;
  now?: Date;
}

export interface ExecutePlannedStepResult {
  runId: string;
  stepId: string;
  attemptId: string;
  status: Awaited<ReturnType<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>>["status"];
  nextAction: Awaited<ReturnType<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>>["nextAction"];
  runStatus: ReturnType<typeof refreshRunStatusFromAttempts>["status"];
  materializedDiff: AttemptDiffMaterialization;
}

export type AttemptDiffMaterialization =
  | { status: "applied"; diffRef: string; patchPath: string; targetPath: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; diffRef: string; patchPath: string; targetPath: string; reason: string };

function auditExecutorModelSelected(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  runner: string;
  selection: ExecutorSelection;
  now: Date;
}): void {
  appendAuditEvent(params.cwd, {
    eventType: "executor_model_selected",
    runId: params.runId,
    timestamp: params.now.toISOString(),
    payload: {
      stepId: params.stepId,
      attemptId: params.attemptId,
      runner: params.runner,
      requestedCapability: params.selection.requestedCapability,
      selectedCapability: params.selection.selectedCapability,
      modelId: params.selection.model?.id ?? null,
      providerName: params.selection.model?.provider ?? null,
      accessMode: params.selection.model?.accessMode ?? null,
      reason: params.selection.reason,
    },
  });
}

function materializeAttemptDiff(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  repoPath: string;
  result: Awaited<ReturnType<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>>;
}): AttemptDiffMaterialization {
  if (params.result.runnerStatus !== ContractValues.Completed) {
    return { status: "skipped", reason: `runner status is ${params.result.runnerStatus}` };
  }

  const diffArtifact = params.result.artifactRefs.find((artifact) => artifact.type === ArtifactTypes.Diff);
  if (!diffArtifact) return { status: "skipped", reason: "attempt produced no diff artifact" };

  const applied = applyDiffArtifactToSource({
    cwd: params.cwd,
    runId: params.runId,
    diffRef: diffArtifact.ref,
    sourcePath: params.repoPath,
  });
  const base = {
    diffRef: diffArtifact.ref,
    patchPath: applied.patchPath,
    targetPath: params.repoPath,
  };

  if (applied.applied) {
    appendAuditEvent(params.cwd, {
      eventType: "attempt_diff_applied",
      runId: params.runId,
      timestamp: new Date().toISOString(),
      payload: {
        stepId: params.stepId,
        attemptId: params.attemptId,
        diffRef: diffArtifact.ref,
        targetPath: params.repoPath,
      },
    });
    return { status: "applied", ...base };
  }

  if (applied.reason?.startsWith("source path is not a git repository:")) {
    return { status: "skipped", reason: applied.reason };
  }

  const failed = { status: "failed" as const, ...base, reason: applied.reason ?? "git apply failed" };
  appendAuditEvent(params.cwd, {
    eventType: "attempt_diff_apply_failed",
    runId: params.runId,
    timestamp: new Date().toISOString(),
    payload: {
      stepId: params.stepId,
      attemptId: params.attemptId,
      diffRef: diffArtifact.ref,
      targetPath: params.repoPath,
      reason: failed.reason,
    },
  });
  return failed;
}

function selectStepRunner(params: {
  cwd: string;
  runId: string;
  stepId: string;
  decision: SchedulerDecision;
  registryModels: ModelEntry[];
  policy: KiwiPolicy;
  runnerResolution: RunnerResolution | null;
  isResearchStep: boolean;
  now: Date;
}): { runnerAdapter: StepAttemptRunner<SandboxCommandPolicy>; selectedModelId: string | null } {
  const researcherSelection = params.isResearchStep
    ? new ResearcherProviderRegistry().select({ registryModels: params.registryModels })
    : null;
  if (params.isResearchStep && !researcherSelection) {
    throw new Error("No enabled researcher model with an available access mode found in .kiwi/model-registry.yaml");
  }

  const executorSelection = params.runnerResolution?.selectExecutorModel(params.decision.modelCapability);
  if (executorSelection) {
    auditExecutorModelSelected({
      cwd: params.cwd,
      runId: params.runId,
      stepId: params.stepId,
      attemptId: params.decision.attemptId,
      runner: params.decision.runner ?? RunnerNames.Api,
      selection: executorSelection,
      now: params.now,
    });
  }

  if (params.isResearchStep && researcherSelection) {
    return {
      runnerAdapter: new ResearcherStepRunner(
        researcherSelection.provider,
        researcherSelection.model,
        params.policy,
        researcherSelection.model.accessMode,
      ),
      selectedModelId: researcherSelection.model.id,
    };
  }

  if (!params.runnerResolution || !params.decision.runner) {
    throw new Error("Runner resolution is required for non-research steps");
  }
  return {
    runnerAdapter: params.runnerResolution.buildAdapter(params.decision.runner, executorSelection?.model),
    selectedModelId: executorSelection?.model?.id ?? null,
  };
}

export async function executePlannedStep(input: ExecutePlannedStepInput): Promise<ExecutePlannedStepResult> {
  const policy = loadPolicy(kiwiPolicyPath(input.cwd));
  const registry = loadRegistry(kiwiModelRegistryPath(input.cwd));
  const initiative = loadInitiative(input.runId, input.cwd);
  const repoPath = initiative.repoPath || input.cwd;
  const taskGraph = loadTaskGraph(input.runId, input.cwd);
  const step = taskGraph.steps.find((entry) => entry.stepId === input.stepId);
  if (!step) throw new Error(`Step not found: ${input.stepId}`);
  assertStepDependenciesCompleted({
    cwd: input.cwd,
    runId: input.runId,
    stepId: input.stepId,
    dependsOn: step.dependsOn,
  });
  const now = input.now ?? new Date();
  const isResearchStep = step.type === "context_discovery";
  const runnerResolution = isResearchStep ? null : resolveRunner({ registryModels: registry.models, step });
  const decision = scheduleStepAttempt({
    cwd: input.cwd,
    runId: input.runId,
    step,
    initiative,
    budgetProfile: initiative.budgetProfile,
    budgetRemainingUsdEstimate: remainingBudgetUsdEstimate({
      cwd: input.cwd,
      runId: input.runId,
      budgetProfile: initiative.budgetProfile,
    }),
    blastRadius: initiative.riskProfile === "production" ? "high" : "low",
    securitySensitivity: initiative.riskProfile === "production" ? "high" : "low",
    contextSize: "small",
    runnerAvailability: isResearchStep ? [RunnerNames.Api] : (runnerResolution?.runnerAvailability ?? []),
    now,
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
  });
  if (decision.status !== "scheduled") {
    throw new Error(`Step could not be scheduled: ${decision.blockedReason ?? "unknown"}`);
  }
  if (!decision.runner) throw new Error("Scheduler selected no runner");
  const approval = loadApprovalDecision({ cwd: input.cwd, runId: input.runId, attemptId: decision.attemptId });
  const approved = input.approved ?? approval?.state === "auto";
  const sandbox = createWorktreeSandbox({
    cwd: input.cwd,
    runId: input.runId,
    attemptId: decision.attemptId,
    sourcePath: repoPath,
  });
  const profile = commandProfileForStep(policy, step.type);
  const commandPolicy = commandProfileToExecutionPolicy(profile) as SandboxCommandPolicy;
  const command = input.command ?? noopCommand();
  const reviewEngine = createReviewEngineFromRegistry({
    cwd: input.cwd,
    policy,
    registryModels: registry.models,
  });
  const { runnerAdapter, selectedModelId } = selectStepRunner({
    cwd: input.cwd,
    runId: input.runId,
    stepId: input.stepId,
    decision,
    registryModels: registry.models,
    policy,
    runnerResolution,
    isResearchStep,
    now,
  });
  let result: Awaited<ReturnType<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>>;
  let materializedDiff: AttemptDiffMaterialization = { status: "skipped", reason: "attempt did not run" };
  try {
    const orchestratorInput: Parameters<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>[0] = {
      cwd: input.cwd,
      repoPath,
      step,
      schedulerDecision: decision,
      selectedModelId,
      runner: runnerAdapter,
      worktreePath: sandbox.worktreePath,
      stepPrompt: step.title,
      allowedTools: ["shell"],
      command,
      commandPolicy,
      approved,
      postRunnerGateExecutor: (params) =>
        runRequiredGates({
          cwd: input.cwd,
          runId: input.runId,
          stepId: input.stepId,
          attemptId: decision.attemptId,
          worktreePath: sandbox.worktreePath,
          policy,
          requiredGates: decision.requiredGates,
          approved,
          diffHash: params.diffHash,
          now,
        }),
      policy,
      now,
    };
    if (reviewEngine) orchestratorInput.reviewEngine = reviewEngine;
    try {
      result = await new StepAttemptOrchestrator<SandboxCommandPolicy>().execute(orchestratorInput);
      materializedDiff = materializeAttemptDiff({
        cwd: input.cwd,
        runId: input.runId,
        stepId: input.stepId,
        attemptId: decision.attemptId,
        repoPath,
        result,
      });
      if (materializedDiff.status === "failed") {
        throw new Error(`Attempt diff could not be applied to current codebase: ${materializedDiff.reason}`);
      }
    } catch (error) {
      refreshRunStatusFromAttempts({ cwd: input.cwd, runId: input.runId, now: new Date() });
      throw error;
    }
  } finally {
    teardownWorktreeSandbox({
      cwd: input.cwd,
      runId: input.runId,
      attemptId: decision.attemptId,
      sourcePath: sandbox.sourcePath,
      isolation: sandbox.isolation,
      worktreePath: sandbox.worktreePath,
    });
  }
  const run = refreshRunStatusFromAttempts({ cwd: input.cwd, runId: input.runId, now: new Date() });
  return {
    runId: input.runId,
    stepId: input.stepId,
    attemptId: decision.attemptId,
    status: result.status,
    nextAction: result.nextAction,
    runStatus: run.status,
    materializedDiff,
  };
}
