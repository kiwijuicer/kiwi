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
  estimateAttemptCostUsd,
  refreshRunStatusFromAttempts,
  resolveRunArtifactPath,
} from "@kiwi/core";
import {
  AccessModes,
  ArtifactTypes,
  ContractValues,
  Initiative,
  KiwiPolicy,
  ModelEntry,
  RunnerNames,
  Step,
} from "@kiwi/contracts";
import {
  createGitTreeSnapshot,
  createWorktreeSandbox,
  SandboxCommandPolicy,
  teardownWorktreeSandbox,
} from "@kiwi/sandbox";
import { commandProfileForStep, commandProfileToExecutionPolicy, noopCommand } from "./operator-policy";
import { createReviewEngineFromRegistry } from "./provider-review-engine";
import { ResearcherProviderRegistry } from "./researcher-provider-registry";
import { LocalResearchStepRunner, ResearcherStepRunner } from "./researcher-step-runner";
import { resolveRunner } from "./runner-resolution";
import type { ExecutorSelection, RunnerResolution } from "./runner-registry";
import { runRequiredGates } from "./required-gates";
import { previewStepAttempt, saveSchedulerDecision, scheduleStepAttempt } from "./scheduler-policy";
import type { SchedulerDecision } from "./scheduler-policy";
import { StepAttemptOrchestrator } from "./step-attempt-orchestrator";
import type { StepAttemptRunner } from "./step-runner-types";

function shouldUseProviderResearch(): boolean {
  return process.env.KIWI_RESEARCHER_MODE === "provider";
}

function executionMode(policy: KiwiPolicy): "direct" | "worktree" {
  if (process.env.KIWI_EXECUTION_ISOLATION === "worktree") return "worktree";
  if (process.env.KIWI_EXECUTION_ISOLATION === "direct") return "direct";
  return policy.execution?.isolation ?? "direct";
}

function executionOwner(policy: KiwiPolicy): "kiwi-codex-cli" {
  return policy.execution?.owner ?? "kiwi-codex-cli";
}

function codexSandbox(policy: KiwiPolicy): "read-only" | "workspace-write" | "danger-full-access" {
  return policy.execution?.sandbox ?? "workspace-write";
}

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
  executionMode: "direct" | "worktree";
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

function auditProviderPreference(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  role: string;
  selectedAccessMode: string | null;
  selectedModelId: string | null;
  preference: string[];
  now: Date;
}): void {
  if (params.preference.length === 0) return;
  appendAuditEvent(params.cwd, {
    eventType: "provider_preference_applied",
    runId: params.runId,
    timestamp: params.now.toISOString(),
    payload: {
      stepId: params.stepId,
      attemptId: params.attemptId,
      role: params.role,
      selectedAccessMode: params.selectedAccessMode,
      selectedModelId: params.selectedModelId,
      preference: params.preference,
    },
  });
}

function materializeAttemptDiff(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  repoPath: string;
  directExecution: boolean;
  result: Awaited<ReturnType<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>>;
}): AttemptDiffMaterialization {
  if (params.result.runnerStatus !== ContractValues.Completed) {
    return { status: "skipped", reason: `runner status is ${params.result.runnerStatus}` };
  }

  const diffArtifact = params.result.artifactRefs.find((artifact) => artifact.type === ArtifactTypes.Diff);
  if (!diffArtifact) return { status: "skipped", reason: "attempt produced no diff artifact" };

  if (params.directExecution) {
    appendAuditEvent(params.cwd, {
      eventType: "attempt_diff_applied",
      runId: params.runId,
      timestamp: new Date().toISOString(),
      payload: {
        stepId: params.stepId,
        attemptId: params.attemptId,
        diffRef: diffArtifact.ref,
        targetPath: params.repoPath,
        mode: "direct",
      },
    });
    return {
      status: "applied",
      diffRef: diffArtifact.ref,
      patchPath: resolveRunArtifactPath(params.runId, diffArtifact.ref, params.cwd),
      targetPath: params.repoPath,
    };
  }

  return {
    status: "skipped",
    reason: `diff persisted for review: ${diffArtifact.ref}`,
  };
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
}): {
  runnerAdapter: StepAttemptRunner<SandboxCommandPolicy>;
  selectedModel: ModelEntry | null;
  selectedModelId: string | null;
  executorSelectionReason: string | null;
} {
  if (params.isResearchStep && !shouldUseProviderResearch()) {
    return {
      runnerAdapter: new LocalResearchStepRunner(params.policy),
      selectedModel: null,
      selectedModelId: "local-researcher",
      executorSelectionReason: "local_researcher",
    };
  }

  const researcherSelection = params.isResearchStep
    ? new ResearcherProviderRegistry().select({
        registryModels: params.registryModels,
        preferenceByRole: params.policy.routing.providerPreference,
      })
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
    auditProviderPreference({
      cwd: params.cwd,
      runId: params.runId,
      stepId: params.stepId,
      attemptId: params.decision.attemptId,
      role: ContractValues.Executor,
      selectedAccessMode: executorSelection.model?.accessMode ?? null,
      selectedModelId: executorSelection.model?.id ?? null,
      preference: params.policy.routing.providerPreference.executor ?? [],
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
      selectedModel: researcherSelection.model,
      selectedModelId: researcherSelection.model.id,
      executorSelectionReason: "researcher_provider",
    };
  }

  if (!params.runnerResolution || !params.decision.runner) {
    throw new Error("Runner resolution is required for non-research steps");
  }
  if (params.decision.runner === RunnerNames.Codex) {
    if (!executorSelection?.model || executorSelection.model.accessMode !== AccessModes.CodexCli) {
      throw new Error(
        `Codex runner selected for ${params.stepId}, but no matching codex-cli model is available in .kiwi/model-registry.yaml`,
      );
    }
    if (!executorSelection.model.providerModel) {
      throw new Error(`Codex model '${executorSelection.model.id}' must define providerModel for enforced model switching`);
    }
  }
  return {
    runnerAdapter: params.runnerResolution.buildAdapter(params.decision.runner, executorSelection?.model),
    selectedModel: executorSelection?.model ?? null,
    selectedModelId: executorSelection?.model?.id ?? null,
    executorSelectionReason: executorSelection?.reason ?? null,
  };
}

interface ExecutionTarget {
  mode: "direct" | "worktree";
  runId: string;
  attemptId: string;
  worktreePath: string;
  sourcePath: string;
  isolation: "direct" | "git-worktree" | "copy-folder";
  diffBaseTree: string | null;
}

function createExecutionTarget(params: {
  cwd: string;
  runId: string;
  attemptId: string;
  repoPath: string;
  mode: "direct" | "worktree";
}): ExecutionTarget {
  const mode = params.mode;
  if (mode === "worktree") {
    const sandbox = createWorktreeSandbox({
      cwd: params.cwd,
      runId: params.runId,
      attemptId: params.attemptId,
      sourcePath: params.repoPath,
    });
    return {
      mode,
      runId: params.runId,
      attemptId: params.attemptId,
      worktreePath: sandbox.worktreePath,
      sourcePath: sandbox.sourcePath,
      isolation: sandbox.isolation,
      diffBaseTree: null,
    };
  }

  return {
    mode,
    runId: params.runId,
    attemptId: params.attemptId,
    worktreePath: params.repoPath,
    sourcePath: params.repoPath,
    isolation: "direct",
    diffBaseTree: createGitTreeSnapshot(params.repoPath),
  };
}

function teardownExecutionTarget(params: { cwd: string; target: ExecutionTarget }): void {
  if (params.target.isolation === "direct") return;
  teardownWorktreeSandbox({
    cwd: params.cwd,
    runId: params.target.runId,
    attemptId: params.target.attemptId,
    sourcePath: params.target.sourcePath,
    isolation: params.target.isolation,
    worktreePath: params.target.worktreePath,
  });
}

function scheduleCurrentStepAttempt(params: {
  input: ExecutePlannedStepInput;
  step: Step;
  initiative: Initiative;
  runnerResolution: RunnerResolution | null;
  isResearchStep: boolean;
  now: Date;
}): SchedulerDecision {
  const decision = scheduleStepAttempt({
    cwd: params.input.cwd,
    runId: params.input.runId,
    step: params.step,
    initiative: params.initiative,
    budgetProfile: params.initiative.budgetProfile,
    budgetRemainingUsdEstimate: remainingBudgetUsdEstimate({
      cwd: params.input.cwd,
      runId: params.input.runId,
      budgetProfile: params.initiative.budgetProfile,
    }),
    blastRadius: params.initiative.riskProfile === "production" ? "high" : "low",
    securitySensitivity: params.initiative.riskProfile === "production" ? "high" : "low",
    contextSize: "small",
    runnerAvailability: params.isResearchStep ? [RunnerNames.Api] : (params.runnerResolution?.runnerAvailability ?? []),
    now: params.now,
    ...(params.input.attemptId ? { attemptId: params.input.attemptId } : {}),
  });
  if (decision.status !== "scheduled") {
    throw new Error(`Step could not be scheduled: ${decision.blockedReason ?? "unknown"}`);
  }
  if (!decision.runner) throw new Error("Scheduler selected no runner");
  return decision;
}

function resolveStepRunnerResolution(params: {
  isResearchStep: boolean;
  registryModels: ModelEntry[];
  step: Step;
  policy: KiwiPolicy;
}): RunnerResolution | null {
  if (params.isResearchStep) return null;
  return resolveRunner({
    registryModels: params.registryModels,
    step: params.step,
    preferenceByRole: params.policy.routing.providerPreference,
  });
}

function enrichSchedulerDecision(params: {
  cwd: string;
  decision: SchedulerDecision;
  policy: KiwiPolicy;
  selectedModel: ModelEntry | null;
  selectedModelId: string | null;
  executorSelectionReason: string | null;
  isolation: "direct" | "worktree";
}): SchedulerDecision {
  const enriched: SchedulerDecision = {
    ...params.decision,
    selectedModelId: params.selectedModelId,
    selectedProviderModel: params.selectedModel?.providerModel ?? null,
    selectedAccessMode: params.selectedModel?.accessMode ?? null,
    executorSelectionReason: params.executorSelectionReason,
    estimatedAttemptCostUsd: estimateAttemptCostUsd({
      modelId: params.selectedModelId,
      capability: params.decision.modelCapability,
      contextLevel: params.decision.contextLevel,
    }),
    executionOwner: executionOwner(params.policy),
    executionIsolation: params.isolation,
  };
  saveSchedulerDecision(params.cwd, enriched);
  return enriched;
}

export interface RunExecutionPreviewStep {
  stepId: string;
  title: string;
  type: string;
  status: SchedulerDecision["status"];
  blockedReason?: string;
  agentRole: string;
  modelCapability: string;
  runner: string | null;
  selectedModelId: string | null;
  selectedProviderModel: string | null;
  selectedAccessMode: string | null;
  executorSelectionReason: string | null;
  estimatedAttemptCostUsd: number;
  reviewDepth: string;
  requiredGates: string[];
  routingReason: string[];
  contextLevel: string;
  executionOwner: "kiwi-codex-cli";
  executionIsolation: "direct" | "worktree";
}

export interface RunExecutionPreview {
  runId: string;
  executionOwner: "kiwi-codex-cli";
  executionIsolation: "direct" | "worktree";
  maxConcurrency: number;
  subPlans: NonNullable<ReturnType<typeof loadTaskGraph>["subPlans"]>;
  steps: RunExecutionPreviewStep[];
}

function previewSelection(params: {
  decision: SchedulerDecision;
  isResearchStep: boolean;
  registryModels: ModelEntry[];
  policy: KiwiPolicy;
  runnerResolution: RunnerResolution | null;
}): { selectedModel: ModelEntry | null; selectedModelId: string | null; reason: string | null } {
  if (params.decision.status !== "scheduled") {
    return { selectedModel: null, selectedModelId: null, reason: null };
  }
  if (params.isResearchStep && !shouldUseProviderResearch()) {
    return { selectedModel: null, selectedModelId: "local-researcher", reason: "local_researcher" };
  }
  if (params.isResearchStep) {
    const selected = new ResearcherProviderRegistry().select({
      registryModels: params.registryModels,
      preferenceByRole: params.policy.routing.providerPreference,
    });
    return {
      selectedModel: selected?.model ?? null,
      selectedModelId: selected?.model.id ?? null,
      reason: selected ? "researcher_provider" : "no_model_available",
    };
  }
  const selection = params.runnerResolution?.selectExecutorModel(params.decision.modelCapability);
  return {
    selectedModel: selection?.model ?? null,
    selectedModelId: selection?.model?.id ?? null,
    reason: selection?.reason ?? null,
  };
}

function stepPreview(params: {
  input: { cwd: string; runId: string; attemptId?: string; now?: Date };
  step: Step;
  initiative: Initiative;
  registryModels: ModelEntry[];
  policy: KiwiPolicy;
  isolation: "direct" | "worktree";
}): RunExecutionPreviewStep {
  const isResearchStep = params.step.type === "context_discovery";
  const runnerResolution = resolveStepRunnerResolution({
    isResearchStep,
    registryModels: params.registryModels,
    step: params.step,
    policy: params.policy,
  });
  const decision = previewStepAttempt({
    cwd: params.input.cwd,
    runId: params.input.runId,
    step: params.step,
    initiative: params.initiative,
    budgetProfile: params.initiative.budgetProfile,
    budgetRemainingUsdEstimate: remainingBudgetUsdEstimate({
      cwd: params.input.cwd,
      runId: params.input.runId,
      budgetProfile: params.initiative.budgetProfile,
    }),
    blastRadius: params.initiative.riskProfile === "production" ? "high" : "low",
    securitySensitivity: params.initiative.riskProfile === "production" ? "high" : "low",
    contextSize: "small",
    runnerAvailability: isResearchStep ? [RunnerNames.Api] : (runnerResolution?.runnerAvailability ?? []),
    attemptId: params.input.attemptId ?? `attempt_preview_${params.step.stepId.replace("step_", "")}`,
    ...(params.input.now ? { now: params.input.now } : {}),
  });
  const selection = previewSelection({
    decision,
    isResearchStep,
    registryModels: params.registryModels,
    policy: params.policy,
    runnerResolution,
  });
  const estimatedAttemptCostUsd = estimateAttemptCostUsd({
    modelId: selection.selectedModelId,
    capability: decision.modelCapability,
    contextLevel: decision.contextLevel,
  });
  const preview: RunExecutionPreviewStep = {
    stepId: params.step.stepId,
    title: params.step.title,
    type: params.step.type,
    status: decision.status,
    agentRole: decision.agentRole,
    modelCapability: decision.modelCapability,
    runner: decision.runner,
    selectedModelId: selection.selectedModelId,
    selectedProviderModel: selection.selectedModel?.providerModel ?? null,
    selectedAccessMode: selection.selectedModel?.accessMode ?? null,
    executorSelectionReason: selection.reason,
    estimatedAttemptCostUsd,
    reviewDepth: decision.reviewDepth,
    requiredGates: decision.requiredGates,
    routingReason: decision.routingReason,
    contextLevel: decision.contextLevel,
    executionOwner: executionOwner(params.policy),
    executionIsolation: params.isolation,
  };
  if (decision.blockedReason) preview.blockedReason = decision.blockedReason;
  return preview;
}

export function buildRunExecutionPreview(params: {
  cwd: string;
  runId: string;
  fromStep?: string;
  maxConcurrency?: number;
  now?: Date;
}): RunExecutionPreview {
  const policy = loadPolicy(kiwiPolicyPath(params.cwd));
  const registry = loadRegistry(kiwiModelRegistryPath(params.cwd));
  const initiative = loadInitiative(params.runId, params.cwd);
  const taskGraph = loadTaskGraph(params.runId, params.cwd);
  const startIndex = params.fromStep ? taskGraph.steps.findIndex((step) => step.stepId === params.fromStep) : 0;
  if (startIndex < 0) throw new Error(`Step not found: ${params.fromStep}`);
  const isolation = executionMode(policy);
  return {
    runId: params.runId,
    executionOwner: executionOwner(policy),
    executionIsolation: isolation,
    maxConcurrency: params.maxConcurrency ?? 2,
    subPlans: taskGraph.subPlans ?? [],
    steps: taskGraph.steps.slice(startIndex).map((step) =>
      stepPreview({
        input: { cwd: params.cwd, runId: params.runId, ...(params.now ? { now: params.now } : {}) },
        step,
        initiative,
        registryModels: registry.models,
        policy,
        isolation,
      }),
    ),
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
  const runnerResolution = resolveStepRunnerResolution({ isResearchStep, registryModels: registry.models, step, policy });
  const decision = scheduleCurrentStepAttempt({
    input,
    step,
    initiative,
    runnerResolution,
    isResearchStep,
    now,
  });
  const approval = loadApprovalDecision({ cwd: input.cwd, runId: input.runId, attemptId: decision.attemptId });
  const approved = input.approved ?? approval?.state === "auto";
  const selectedIsolation = executionMode(policy);
  const { runnerAdapter, selectedModel, selectedModelId, executorSelectionReason } = selectStepRunner({
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
  const enrichedDecision = enrichSchedulerDecision({
    cwd: input.cwd,
    decision,
    policy,
    selectedModel,
    selectedModelId,
    executorSelectionReason,
    isolation: selectedIsolation,
  });
  const target = createExecutionTarget({
    cwd: input.cwd,
    runId: input.runId,
    attemptId: decision.attemptId,
    repoPath,
    mode: selectedIsolation,
  });
  const profile = commandProfileForStep(policy, step.type);
  const commandPolicy = commandProfileToExecutionPolicy(profile) as SandboxCommandPolicy;
  const command = input.command ?? noopCommand();
  const reviewEngine = createReviewEngineFromRegistry({
    cwd: input.cwd,
    policy,
    registryModels: registry.models,
  });
  let result: Awaited<ReturnType<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>>;
  let materializedDiff: AttemptDiffMaterialization = { status: "skipped", reason: "attempt did not run" };
  try {
    const orchestratorInput: Parameters<StepAttemptOrchestrator<SandboxCommandPolicy>["execute"]>[0] = {
      cwd: input.cwd,
      repoPath,
      step,
      schedulerDecision: enrichedDecision,
      selectedModelId,
      runner: runnerAdapter,
      worktreePath: target.worktreePath,
      executionMode: target.mode,
      codexSandbox: codexSandbox(policy),
      diffBaseTree: target.diffBaseTree,
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
          attemptId: enrichedDecision.attemptId,
          worktreePath: target.worktreePath,
          policy,
          requiredGates: enrichedDecision.requiredGates,
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
        attemptId: enrichedDecision.attemptId,
        repoPath,
        directExecution: target.mode === "direct",
        result,
      });
      if (materializedDiff.status === ContractValues.Failed) {
        throw new Error(`Attempt diff could not be applied to current codebase: ${materializedDiff.reason}`);
      }
    } catch (error) {
      refreshRunStatusFromAttempts({ cwd: input.cwd, runId: input.runId, now: new Date() });
      throw error;
    }
  } finally {
    teardownExecutionTarget({ cwd: input.cwd, target });
  }
  const run = refreshRunStatusFromAttempts({ cwd: input.cwd, runId: input.runId, now: new Date() });
  return {
    runId: input.runId,
    stepId: input.stepId,
    attemptId: enrichedDecision.attemptId,
    executionMode: target.mode,
    status: result.status,
    nextAction: result.nextAction,
    runStatus: run.status,
    materializedDiff,
  };
}
