import { runPlannerProviderWithRetries } from "@kiwi/adapters";
import { ContractValues, ProgressStatuses } from "@kiwi/contracts";
import { resolvePlannerProvider } from "@kiwi/runtime";
import { buildRunCostForecast, loadEffectivePolicy, loadEffectiveRegistry, planRun } from "@kiwi/core";
import { callCoreTool } from "./core-dispatch";
import { doctorTool } from "./doctor";
import { withOperatorCard } from "../ux/operator-card";
import { previewRunTool, runStepTool, runTool } from "./run-tools";
import { progressLine, startHeartbeat, stopHeartbeat, type ToolCallOptions } from "./helpers";
import { validateToolArguments } from "./input-schemas";
import { toolCall, type McpNextAction, mutationScope } from "../ux";
import { workspaceArgs } from "../workspace";

function planNextAction(planned: Awaited<ReturnType<typeof planRun>>): McpNextAction {
  return {
    recommendedToolCall: toolCall("kiwi_preview_run", {
      workspacePath: planned.workspacePath,
      repoId: planned.repoId,
      repoPath: planned.repoPath,
      runId: planned.runId,
    }),
    whyThisTool: "Planning wrote run artifacts; preview is the required decision step before any execution.",
    requiresUserConfirmation: false,
    expectedMutation: "WRITES_RUN_ARTIFACTS",
    expectedAfter: "Show the preview decision card and ask the user before running.",
  };
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
  let planned: Awaited<ReturnType<typeof planRun>>;

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
  const costForecast = buildRunCostForecast({
    taskGraph: planned.taskGraph,
    plannerCostUsd: planned.plannerOutput.cost.estimatedUsd,
    registryModels: registry.models,
  });
  const nextAction = planNextAction(planned);

  return withOperatorCard(
    {
      schemaVersion: "2",
      kind: "planned_run",
      runId: planned.runId,
      planId: planned.taskGraph.planId,
      workspace: {
        workspacePath: planned.workspacePath,
        repoId: planned.repoId,
        repoPath: planned.repoPath,
      },
      taskGraph: {
        summary: planned.taskGraph.summary,
        stepCount: planned.taskGraph.steps.length,
        acceptanceCriteria: planned.taskGraph.acceptanceCriteria,
        assumptions: planned.taskGraph.assumptions,
        openQuestions: planned.taskGraph.openQuestions,
      },
      planner: {
        modelId: planned.plannerModelId,
        providerName: planned.providerName,
        providerModel: resolution.model.providerModel ?? null,
      },
      cost: {
        estimatedCostUsd: costForecast.estimatedCostUsd,
        forecast: costForecast,
      },
      execution: {
        owner: policy.execution?.owner ?? "kiwi-codex-cli",
        isolation: policy.execution?.isolation ?? "direct",
        sandbox: policy.execution?.sandbox ?? "workspace-write",
        forbidStaging: policy.execution?.forbidStaging ?? true,
        forbidCommits: policy.execution?.forbidCommits ?? true,
        forbidPushes: policy.execution?.forbidPushes ?? true,
      },
      nextAction,
    },
    {
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
  const workspace = workspaceArgs(validatedArgs, cwd, false);
  const workspacePath = workspace.workspacePath;
  const coreResult = callCoreTool({
    name,
    args: validatedArgs,
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
