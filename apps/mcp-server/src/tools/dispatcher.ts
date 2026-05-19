import { runPlannerProviderWithRetries } from "@kiwi/adapters";
import { AgentRoles, ContractValues, ModelCapabilities, ProgressStatuses } from "@kiwi/contracts";
import {
  recordFeedbackAndReplan,
  resolvePlannerProvider,
  RunCostForecastService,
  type RunCostForecast,
} from "@kiwi/runtime";
import { loadEffectivePolicy, loadEffectiveRegistry, planRun, type WorkspaceResolution } from "@kiwi/core";
import { writePlanMarkdown } from "@kiwi/ops";
import { callCoreTool } from "./core-dispatch.js";
import { doctorTool } from "./doctor.js";
import { withOperatorCard } from "../ux/operator-card.js";
import { previewRunTool, runStepTool, runTool } from "./run-tools.js";
import { progressLine, startHeartbeat, stopHeartbeat, type ToolCallOptions } from "./helpers.js";
import { validateToolArguments } from "./input-schemas.js";
import { toolCall, type McpNextAction, mutationScope, safeReadOnlyToolCalls } from "../ux/index.js";
import { workspaceArgs } from "../workspace/index.js";
import { ToolActionRequiredError } from "./errors.js";
import { nextTool } from "./next-action.js";
import { getMcpServerServices } from "../services.js";
import { modelsUpdateApplyTool, modelsUpdateTool } from "./model-tools.js";

const ACTIVE_RUN_TOOLS = new Set([
  "kiwi_next",
  "kiwi_diff",
  "kiwi_preview_run",
  "kiwi_run",
  "kiwi_run_step",
  "kiwi_apply",
  "kiwi_feedback",
  "kiwi_finalize",
  "kiwi_cost",
  "kiwi_explain",
  "kiwi_request_approval",
  "kiwi_evidence_manifest",
  "kiwi_operator_snapshot",
  "kiwi_publish_pr_draft",
]);

type PlannedRun = Awaited<ReturnType<typeof planRun>>;

class PlannedRunToolPresenter {
  constructor(
    private readonly planned: PlannedRun,
    private readonly costForecast: RunCostForecast,
    private readonly policy: ReturnType<typeof loadEffectivePolicy>,
    private readonly providerModel: string | null,
  ) {}

  nextAction(): McpNextAction {
    return {
      recommendedToolCall: toolCall("kiwi_preview_run", {
        workspacePath: this.planned.workspacePath,
        repoId: this.planned.repoId,
        repoPath: this.planned.repoPath,
        runId: this.planned.runId,
      }),
      whyThisTool: "Planning wrote run artifacts; preview is the required decision step before any execution.",
      requiresUserConfirmation: false,
      expectedMutation: "WRITES_RUN_ARTIFACTS",
      expectedAfter: "Show the preview decision card and ask the user before running.",
    };
  }

  writeMarkdown(): ReturnType<typeof writePlanMarkdown> {
    const taskStepsById = new Map(this.planned.taskGraph.steps.map((step) => [step.stepId, step]));

    return writePlanMarkdown({
      cwd: this.planned.workspacePath,
      runId: this.planned.runId,
      taskGraph: this.planned.taskGraph,
      plannerModelId: this.planned.plannerModelId,
      providerName: this.planned.providerName,
      providerModel: this.providerModel,
      estimatedCostUsd: this.costForecast.estimatedCostUsd,
      steps: this.costForecast.steps.map((step) => {
        const plannedStep = taskStepsById.get(step.stepId);

        return {
          stepId: step.stepId,
          title: step.title,
          type: plannedStep?.type ?? "unknown",
          agentRole: plannedStep?.recommendedAgentRole ?? AgentRoles.Executor,
          modelCapability: plannedStep?.recommendedModelCapability ?? ModelCapabilities.Mid,
          modelId: step.executorModelId,
          providerModel: null,
          estimatedCostUsd: step.totalCostUsd,
        };
      }),
    });
  }

  payload(planMarkdown: ReturnType<typeof writePlanMarkdown>, nextAction: McpNextAction): object {
    return {
      schemaVersion: "2",
      kind: "planned_run",
      runId: this.planned.runId,
      planId: this.planned.taskGraph.planId,
      workspace: {
        workspacePath: this.planned.workspacePath,
        repoId: this.planned.repoId,
        repoPath: this.planned.repoPath,
      },
      taskGraph: {
        summary: this.planned.taskGraph.summary,
        stepCount: this.planned.taskGraph.steps.length,
        acceptanceCriteria: this.planned.taskGraph.acceptanceCriteria,
        assumptions: this.planned.taskGraph.assumptions,
        openQuestions: this.planned.taskGraph.openQuestions,
      },
      planner: {
        modelId: this.planned.plannerModelId,
        providerName: this.planned.providerName,
        providerModel: this.providerModel,
      },
      cost: {
        estimatedCostUsd: this.costForecast.estimatedCostUsd,
        forecast: this.costForecast,
      },
      artifacts: {
        planMarkdown,
      },
      execution: {
        owner: this.policy.execution?.owner ?? "kiwi-codex-cli",
        isolation: this.policy.execution?.isolation ?? "direct",
        sandbox: this.policy.execution?.sandbox ?? "workspace-write",
        forbidStaging: this.policy.execution?.forbidStaging ?? true,
        forbidCommits: this.policy.execution?.forbidCommits ?? true,
        forbidPushes: this.policy.execution?.forbidPushes ?? true,
      },
      nextAction,
    };
  }
}

async function planTool(args: Record<string, unknown>, cwd: string, options: ToolCallOptions = {}): Promise<unknown> {
  const rawInput = String(args.ticket ?? args.rawInput ?? "");
  const workspace = workspaceArgs(args, cwd, true);
  const repo = workspace.repo!;
  const now = new Date();
  const policy = loadEffectivePolicy(workspace.workspacePath);
  const registry = loadEffectiveRegistry(workspace.workspacePath);
  const resolution = resolvePlannerProvider({
    registryModels: registry.models,
    now: () => now,
    preferenceByRole: policy.routing.providerPreference,
  });
  options.onProgress?.(
    progressLine({
      phase: ContractValues.Planner,
      status: ProgressStatuses.Started,
      model: resolution.model.id,
      providerModel: resolution.model.providerModel ?? null,
      provider: resolution.provider.name,
    }),
    0,
  );
  const heartbeat = startHeartbeat(
    progressLine({ phase: ContractValues.Planner, status: ProgressStatuses.Running }),
    options.onProgress,
  );
  let planned: PlannedRun;

  try {
    planned = await planRun({
      workspacePath: workspace.workspacePath,
      repoId: repo.id,
      repoPath: repo.path,
      rawInput,
      source: "mcp",
      policy,
      plannerModel: resolution.model,
      executePlanner: (plannerInput, options) =>
        runPlannerProviderWithRetries(resolution.provider, plannerInput, options),
      riskProfile: args.riskProfile === "production" ? "production" : "dev",
      budgetProfile: args.budgetProfile === "tiny" ? "tiny" : "normal",
      now,
    });
  } finally {
    stopHeartbeat(heartbeat);
  }
  options.onProgress?.(
    progressLine({
      phase: ContractValues.Planner,
      status: ProgressStatuses.Completed,
      runId: planned.runId,
      steps: planned.taskGraph.steps.length,
    }),
    100,
  );
  const costForecast = new RunCostForecastService().build({
    taskGraph: planned.taskGraph,
    policy,
    registry,
    plannerCostUsd: planned.plannerOutput.cost.estimatedUsd,
    plannerModelId: planned.plannerModelId,
  });
  const presenter = new PlannedRunToolPresenter(planned, costForecast, policy, resolution.model.providerModel ?? null);
  const planMarkdown = presenter.writeMarkdown();
  const nextAction = presenter.nextAction();

  return withOperatorCard(presenter.payload(planMarkdown, nextAction), {
    cwd: planned.workspacePath,
    runId: planned.runId,
    lastAction: "kiwi_plan",
    nextAction,
    mutationScope: mutationScope({
      riskLabel: "WRITES_RUN_ARTIFACTS",
      workspacePath: planned.workspacePath,
      repoPath: planned.repoPath,
      executionMode: policy.execution?.isolation ?? "direct",
    }),
  });
}

function resolveActiveRunArgs(
  name: string,
  args: Record<string, unknown>,
  workspace: WorkspaceResolution,
): Record<string, unknown> {
  if (typeof args.runId === "string" || !ACTIVE_RUN_TOOLS.has(name)) {
    return args;
  }
  const active = getMcpServerServices().core.runStatus.active({
    cwd: workspace.workspacePath,
    ...(workspace.repo?.id ? { repoId: workspace.repo.id } : {}),
    ...(workspace.repo?.path ? { repoPath: workspace.repo.path } : {}),
  });

  if (!active) {
    throw new ToolActionRequiredError("No active kiwi run for this repo", {
      category: "action_required",
      recovery: {
        reason: "no_active_run",
        recommendedToolCall: toolCall("kiwi_status", {
          workspacePath: workspace.workspacePath,
          repoId: workspace.repo?.id,
          repoPath: workspace.repo?.path,
        }),
        safeAlternatives: safeReadOnlyToolCalls({
          workspacePath: workspace.workspacePath,
          ...(workspace.repo?.id ? { repoId: workspace.repo.id } : {}),
          ...(workspace.repo?.path ? { repoPath: workspace.repo.path } : {}),
        }),
        userMessage: "No active run was found. Start with kiwi_plan or inspect kiwi_status.",
      },
    });
  }

  return { ...args, runId: active.runId };
}

async function feedbackTool(
  args: Record<string, unknown>,
  cwd: string,
  options: ToolCallOptions = {},
): Promise<unknown> {
  const workspace = workspaceArgs(args, cwd, false);
  const resolvedArgs = resolveActiveRunArgs("kiwi_feedback", args, workspace);
  const runId = String(resolvedArgs.runId ?? "");

  return getMcpServerServices().core.locks.withLock(
    { cwd: workspace.workspacePath, runId, operation: "mcp_feedback" },
    async () => {
      options.onProgress?.(`feedback replan started runId=${runId}`, 0);
      const result = await recordFeedbackAndReplan({
        cwd: workspace.workspacePath,
        runId,
        message: String(resolvedArgs.message ?? ""),
        source: "mcp",
        ...(typeof resolvedArgs.author === "string" ? { author: resolvedArgs.author } : {}),
        ...(typeof resolvedArgs.targetStepId === "string" ? { targetStepId: resolvedArgs.targetStepId } : {}),
        ...(typeof resolvedArgs.targetAttemptId === "string" ? { targetAttemptId: resolvedArgs.targetAttemptId } : {}),
        env: {
          ...process.env,
          KIWI_EXECUTION_ISOLATION: process.env.KIWI_EXECUTION_ISOLATION ?? "direct",
        },
      });
      const next = nextTool(
        { ...resolvedArgs, runId, ...(result.resumeFromStepId ? { fromStep: result.resumeFromStepId } : {}) },
        cwd,
      ) as { nextAction?: McpNextAction };
      options.onProgress?.(`feedback replan completed runId=${runId}`, 100);
      const cardInput: Parameters<typeof withOperatorCard>[1] = {
        cwd: workspace.workspacePath,
        runId,
        lastAction: "kiwi_feedback",
        mutationScope: mutationScope({
          riskLabel: "WRITES_RUN_ARTIFACTS",
          workspacePath: workspace.workspacePath,
          repoPath: workspace.repo?.path ?? null,
          executionMode: process.env.KIWI_EXECUTION_ISOLATION ?? "direct",
        }),
      };

      if (next.nextAction) {
        cardInput.nextAction = next.nextAction;
      }

      return withOperatorCard(
        {
          schemaVersion: "2",
          kind: "feedback_replan_result",
          runId,
          feedbackRef: result.feedbackRef,
          replan: result,
          nextAction: next.nextAction ?? null,
        },
        cardInput,
      );
    },
  );
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
  options: ToolCallOptions = {},
): Promise<unknown> {
  const validatedArgs = validateToolArguments(name, args);

  if (name === "kiwi_doctor") {
    return doctorTool(validatedArgs, cwd);
  }
  if (name === "kiwi_plan") {
    return planTool(validatedArgs, cwd, options);
  }
  if (name === "kiwi_feedback") {
    return feedbackTool(validatedArgs, cwd, options);
  }
  if (name === "kiwi_models_update") {
    return modelsUpdateTool(validatedArgs, cwd);
  }
  if (name === "kiwi_models_update_apply") {
    return modelsUpdateApplyTool(validatedArgs, cwd);
  }
  const workspace = workspaceArgs(validatedArgs, cwd, false);
  const resolvedArgs = resolveActiveRunArgs(name, validatedArgs, workspace);
  const workspacePath = workspace.workspacePath;
  const coreResult = callCoreTool({
    name,
    args: resolvedArgs,
    cwd,
    workspacePath,
    repoPath: workspace.repo?.path ?? null,
    options,
    handlers: {
      previewRunTool,
      runTool,
      runStepTool,
    },
  });

  if (coreResult !== undefined) {
    return coreResult;
  }
  throw new Error(`Unknown tool: ${name}`);
}
