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
import { createWorktreeSandbox, SandboxCommandPolicy, teardownWorktreeSandbox } from "@kiwi/sandbox";
import { commandProfileForStep, commandProfileToExecutionPolicy, noopCommand } from "./operator-policy";
import { createReviewEngineFromRegistry } from "./provider-review-engine";
import { resolveRunner } from "./runner-resolution";
import type { ExecutorSelection } from "./runner-registry";
import { runRequiredGates } from "./required-gates";
import { scheduleStepAttempt } from "./scheduler-policy";
import { StepAttemptOrchestrator } from "./step-attempt-orchestrator";

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
}

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
  const runnerResolution = resolveRunner({ registryModels: registry.models, step });
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
    runnerAvailability: runnerResolution.runnerAvailability,
    now,
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
  });
  if (decision.status !== "scheduled") {
    throw new Error(`Step could not be scheduled: ${decision.blockedReason ?? "unknown"}`);
  }
  if (!decision.runner) {
    throw new Error("Scheduler selected no runner");
  }

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
  const executorSelection = runnerResolution.selectExecutorModel(decision.modelCapability);
  auditExecutorModelSelected({
    cwd: input.cwd,
    runId: input.runId,
    stepId: input.stepId,
    attemptId: decision.attemptId,
    runner: decision.runner,
    selection: executorSelection,
    now,
  });
  const runnerAdapter = runnerResolution.buildAdapter(decision.runner, executorSelection.model);
  let result: Awaited<ReturnType<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>>;
  try {
    const orchestratorInput: Parameters<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>[0] = {
      cwd: input.cwd,
      repoPath,
      step,
      schedulerDecision: decision,
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
    result = await new StepAttemptOrchestrator<SandboxCommandPolicy>().execute(orchestratorInput);
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
  };
}
