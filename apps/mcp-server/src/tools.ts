import { runPlannerProviderWithRetries } from "@kiwi/adapters";
import { ContractValues } from "@kiwi/contracts";
import {
  executePlannedStep,
  applyRunDiff,
  buildRunExecutionPreview,
  buildRunDiff,
  DirectExecutionUnsafeError,
  finalizeRun,
  resolvePlannerProvider,
  runScheduledSubPlans,
  splitCommandLine,
  assertDirectExecutionSafe,
} from "@kiwi/runtime";
import {
  buildRunCompletionSummary,
  buildRunExplanation,
  writeEvidenceManifest,
  writeOperatorSnapshot,
} from "@kiwi/ops";
import {
  getRunStatusSummary,
  buildRunCostForecast,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  latestAttemptByStep,
  loadInitiative,
  listStepAttemptEvidence,
  loadPolicy,
  loadRegistry,
  loadTaskGraph,
  planRun,
  readJson,
  recordApprovalDecision,
  resolveRunArtifactPath,
  withRunLock,
} from "@kiwi/core";
import { publishPrDraftTool } from "./publish-tool";
import { doctorTool } from "./doctor";
import { nextTool } from "./next-action";
import { withOperatorCard } from "./operator-card";
import { createMcpPreviewToken, normalizePreviewInput, validateMcpPreviewToken } from "./preview-tokens";
import { ToolActionRequiredError } from "./tool-errors";
import {
  errorMessage,
  previewConfirmationSummary,
  progressLine,
  startHeartbeat,
  stopHeartbeat,
  type ToolCallOptions,
} from "./tool-helpers";
import { validateToolArguments } from "./tool-input-schemas";
import { safeReadOnlyToolCalls, toolCall, type McpNextAction, mutationScope, workspaceToolArgs } from "./ux";
import { workspaceArgs } from "./workspace";

function nextRunAction(params: {
  workspacePath: string;
  repoId?: string | null | undefined;
  repoPath?: string | null | undefined;
  runId: string;
  previewToken: string;
  fromStep?: string | undefined;
  maxConcurrency?: number | undefined;
}): McpNextAction {
  return {
    recommendedToolCall: toolCall("kiwi_run", {
      ...workspaceToolArgs(params),
      previewToken: params.previewToken,
      ...(params.fromStep ? { fromStep: params.fromStep } : {}),
      ...(params.maxConcurrency !== undefined && params.maxConcurrency !== 2
        ? { maxConcurrency: params.maxConcurrency }
        : {}),
    }),
    whyThisTool: "The previewToken is fresh for this run, repo state, policy, and execution options.",
    requiresUserConfirmation: true,
    expectedMutation: "MUTATES_WORKTREE",
    expectedAfter: "Run execution starts and progress notifications describe routing, gates, review, and final state.",
  };
}

function assertMcpDirectExecutionSafe(params: {
  workspacePath: string;
  repoPath: string | null;
  runId: string;
}): void {
  if (!params.repoPath) return;
  try {
    assertDirectExecutionSafe(params.repoPath);
  } catch (error) {
    if (!(error instanceof DirectExecutionUnsafeError)) throw error;
    throw new ToolActionRequiredError(error.message, {
      category: "action_required",
      recovery: {
        reason: error.reasons.join("; "),
        recommendedToolCall: toolCall("kiwi_doctor", { workspacePath: params.workspacePath, repoPath: params.repoPath }),
        safeAlternatives: safeReadOnlyToolCalls({
          workspacePath: params.workspacePath,
          repoPath: params.repoPath,
          runId: params.runId,
        }),
        userMessage: "Direct execution is unsafe. Switch away from main/master, clean the repo, or use worktree isolation.",
      },
    });
  }
}

function approvalRequiredFilesForAttempt(params: {
  workspacePath: string;
  runId: string;
  evidence: ReturnType<typeof listStepAttemptEvidence>[number];
}): string[] {
  const files = new Set<string>();
  for (const gate of params.evidence.gateResults) {
    if (gate.gateType !== "forbidden_file_checks" || gate.status !== ContractValues.Blocked) continue;
    for (const ref of gate.evidenceRefs) {
      const report = readJson(resolveRunArtifactPath(params.runId, ref, params.workspacePath)) as {
        approvalRequiredFiles?: unknown;
      };
      if (!Array.isArray(report.approvalRequiredFiles)) continue;
      for (const file of report.approvalRequiredFiles) {
        if (typeof file === "string" && file.length > 0) files.add(file);
      }
    }
  }
  return Array.from(files).sort();
}

function approvalValidationError(params: {
  workspacePath: string;
  runId: string;
  reason: string;
}): ToolActionRequiredError {
  return new ToolActionRequiredError(`Cannot record approval: ${params.reason}`, {
    category: "action_required",
    recovery: {
      reason: params.reason,
      recommendedToolCall: toolCall("kiwi_next", { workspacePath: params.workspacePath, runId: params.runId }),
      safeAlternatives: safeReadOnlyToolCalls({ workspacePath: params.workspacePath, runId: params.runId }),
      userMessage: "Inspect the current run state and approve only the latest blocked attempt.",
    },
  });
}

function recordMcpApproval(args: Record<string, unknown>, workspacePath: string): unknown {
  const runId = String(args.runId ?? "");
  const attemptId = String(args.attemptId ?? "");
  const attempts = listStepAttemptEvidence(workspacePath, runId);
  const evidence = attempts.find((entry) => entry.attemptId === attemptId);
  if (!evidence) {
    throw approvalValidationError({ workspacePath, runId, reason: `attempt not found: ${attemptId}` });
  }
  const latestForStep = latestAttemptByStep(attempts).get(evidence.stepId);
  if (latestForStep?.attemptId !== attemptId) {
    throw approvalValidationError({
      workspacePath,
      runId,
      reason: `attempt ${attemptId} is not the latest attempt for ${evidence.stepId}`,
    });
  }
  if (evidence.attempt.status !== ContractValues.Blocked) {
    throw approvalValidationError({ workspacePath, runId, reason: `attempt ${attemptId} is not blocked` });
  }
  const approvalRequiredFiles = approvalRequiredFilesForAttempt({ workspacePath, runId, evidence });
  if (approvalRequiredFiles.length === 0) {
    throw approvalValidationError({
      workspacePath,
      runId,
      reason: `attempt ${attemptId} has no approval-required file evidence`,
    });
  }
  return recordApprovalDecision({
    cwd: workspacePath,
    runId,
    stepId: evidence.stepId,
    sourceAttemptId: attemptId,
    approvalRequiredFiles,
    reason: String(args.reason ?? "Approved through MCP"),
    approvedBy: String(args.approvedBy ?? "mcp-operator"),
  });
}

async function planTool(args: Record<string, unknown>, cwd: string, options: ToolCallOptions = {}): Promise<unknown> {
  const rawInput = String(args.ticket ?? args.rawInput ?? "");
  if (!rawInput) {
    throw new Error(
      `kiwi_plan requires ticket or rawInput; received argument keys: ${Object.keys(args).sort().join(", ") || "(none)"}`,
    );
  }
  const workspace = workspaceArgs(args, cwd, true);
  const repo = workspace.repo!;
  const now = new Date();
  const policyPath = kiwiPolicyPath(workspace.workspacePath);
  const policy = loadPolicy(policyPath);
  const registry = loadRegistry(kiwiModelRegistryPath(workspace.workspacePath));
  const resolution = resolvePlannerProvider({
    registryModels: registry.models,
    now: () => now,
    preferenceByRole: policy.routing.providerPreference,
    ...(args.allowStub === true ? { allowStub: true } : {}),
  });
  options.onProgress?.(
    progressLine({
      phase: ContractValues.Planner,
      status: "started",
      model: resolution.model.id,
      providerModel: resolution.model.providerModel ?? null,
      provider: resolution.provider.name,
    }),
    0,
  );
  const heartbeat = startHeartbeat(
    progressLine({ phase: ContractValues.Planner, status: ContractValues.Running }),
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
      status: ContractValues.Completed,
      runId: planned.runId,
      steps: planned.taskGraph.steps.length,
    }),
    100,
  );
  const costForecast = buildRunCostForecast({
    taskGraph: planned.taskGraph,
    plannerCostUsd: planned.plannerOutput.cost.estimatedUsd,
  });
  const nextAction: McpNextAction = {
    recommendedToolCall: toolCall("kiwi_preview_run", {
      workspacePath: planned.workspacePath,
      repoId: planned.repoId,
      repoPath: planned.repoPath,
      runId: planned.runId,
    }),
    whyThisTool: "Planning wrote run artifacts; preview is the required read-only step before any execution.",
    requiresUserConfirmation: false,
    expectedMutation: "READ_ONLY",
    expectedAfter: "Show the preview decision card and ask the user before running.",
  };
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

interface RunStepToolResult {
  attemptId: string;
  status: string;
  nextAction: unknown;
  runStatus: string;
  materializedDiff: unknown;
}

function emitPostAttemptProgress(params: {
  workspacePath: string;
  runId: string;
  stepId: string;
  attemptId: string;
  options: ToolCallOptions;
  stepIndex?: number | undefined;
  stepCount?: number | undefined;
}): void {
  if (!params.options.onProgress) return;
  const evidence = listStepAttemptEvidence(params.workspacePath, params.runId).find(
    (entry) => entry.stepId === params.stepId && entry.attemptId === params.attemptId,
  );
  if (!evidence) return;
  for (const gate of evidence.gateResults) {
    params.options.onProgress(
      progressLine({
        phase: "gate",
        status: gate.status,
        stepId: params.stepId,
        attemptId: params.attemptId,
        gate: gate.gateType,
        reason: gate.reason,
        stepIndex: params.stepIndex,
        stepCount: params.stepCount,
      }),
    );
  }
  if (evidence.reviewVerdict) {
    params.options.onProgress(
      progressLine({
        phase: "review",
        status: ContractValues.Completed,
        stepId: params.stepId,
        attemptId: params.attemptId,
        verdict: evidence.reviewVerdict.verdict,
        safeToContinue: evidence.reviewVerdict.safeToContinue,
        stepIndex: params.stepIndex,
        stepCount: params.stepCount,
      }),
    );
  }
}

function parseMaxConcurrency(args: Record<string, unknown>): number | undefined {
  if (typeof args.maxConcurrency === "number") return args.maxConcurrency;
  if (typeof args.maxConcurrency !== "string" || args.maxConcurrency.trim().length === 0) return undefined;
  const parsed = Number.parseInt(args.maxConcurrency, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`kiwi_run maxConcurrency must be a positive integer; received ${args.maxConcurrency}`);
  }
  return parsed;
}

function previewRunTool(args: Record<string, unknown>, cwd: string): unknown {
  const runId = String(args.runId ?? "");
  if (!runId) throw new Error("kiwi_preview_run requires runId");
  const workspace = workspaceArgs(args, cwd, false);
  const fromStep = typeof args.fromStep === "string" ? args.fromStep : undefined;
  const maxConcurrency = parseMaxConcurrency(args);
  if (maxConcurrency !== undefined && (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0)) {
    throw new Error(`kiwi_preview_run maxConcurrency must be a positive integer; received ${maxConcurrency}`);
  }
  const previewInput = normalizePreviewInput({ fromStep, maxConcurrency });
  const preview = buildRunExecutionPreview({
    cwd: workspace.workspacePath,
    runId,
    ...(fromStep ? { fromStep } : {}),
    ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
  });
  if (preview.executionIsolation === "direct") {
    const initiative = loadInitiative(runId, workspace.workspacePath);
    assertMcpDirectExecutionSafe({
      workspacePath: workspace.workspacePath,
      repoPath: initiative.repoPath || workspace.workspacePath,
      runId,
    });
  }
  const token = createMcpPreviewToken({
    cwd: workspace.workspacePath,
    runId,
    preview,
    previewInput,
  });
  const estimatedCostUsd = preview.steps.reduce((sum, step) => sum + step.estimatedAttemptCostUsd, 0);
  const nextAction = nextRunAction({
    workspacePath: workspace.workspacePath,
    repoId: workspace.repo?.id,
    repoPath: workspace.repo?.path,
    runId,
    previewToken: token.token,
    fromStep,
    maxConcurrency: previewInput.maxConcurrency,
  });
  const runScope = mutationScope({
    riskLabel: "MUTATES_WORKTREE",
    workspacePath: workspace.workspacePath,
    repoPath: token.repoPath,
    executionMode: preview.executionIsolation,
  });
  const previewScope = mutationScope({
    riskLabel: "WRITES_RUN_ARTIFACTS",
    workspacePath: workspace.workspacePath,
    repoPath: token.repoPath,
    executionMode: preview.executionIsolation,
  });
  return withOperatorCard(
    {
      schemaVersion: "2",
      kind: "run_execution_preview",
      previewToken: token.token,
      previewResource: `kiwi://runs/${runId}/previews/${token.token}`,
      runId,
      workspace: {
        workspacePath: workspace.workspacePath,
        repoId: workspace.repo?.id ?? null,
        repoPath: token.repoPath,
      },
      decision: {
        requiresUserConfirmation: true,
        confirmationSummary: previewConfirmationSummary({
          stepCount: preview.steps.length,
          repoPath: token.repoPath,
          executionIsolation: preview.executionIsolation,
          estimatedCostUsd,
        }),
        nextAction,
      },
      execution: {
        owner: preview.executionOwner,
        isolation: preview.executionIsolation,
        maxConcurrency: preview.maxConcurrency,
        subPlans: preview.subPlans,
        mutationScope: runScope,
      },
      cost: {
        estimatedCostUsd,
        currency: "USD",
      },
      steps: preview.steps.map((step, index) => ({
        index: index + 1,
        count: preview.steps.length,
        stepId: step.stepId,
        title: step.title,
        type: step.type,
        status: step.status,
        blockedReason: step.blockedReason ?? null,
        agentRole: step.agentRole,
        modelCapability: step.modelCapability,
        runner: step.runner,
        selectedModelId: step.selectedModelId,
        selectedProviderModel: step.selectedProviderModel,
        selectedAccessMode: step.selectedAccessMode,
        executorSelectionReason: step.executorSelectionReason,
        estimatedAttemptCostUsd: step.estimatedAttemptCostUsd,
        requiredGates: step.requiredGates,
        routingReason: step.routingReason,
        reviewDepth: step.reviewDepth,
        contextLevel: step.contextLevel,
      })),
      safeAlternatives: safeReadOnlyToolCalls({ workspacePath: workspace.workspacePath, runId }),
    },
    {
      cwd: workspace.workspacePath,
      runId,
      lastAction: "kiwi_preview_run",
      nextAction,
      mutationScope: previewScope,
    },
  );
}

async function runStepToolUnlocked(
  args: Record<string, unknown>,
  workspacePath: string,
  options: ToolCallOptions = {},
  progressContext: { stepIndex?: number; stepCount?: number } = {},
): Promise<RunStepToolResult> {
  const runId = String(args.runId ?? "");
  const stepId = String(args.stepId ?? "");
  if (!runId || !stepId) throw new Error("kiwi_run_step requires runId and stepId");
  const input: Parameters<typeof executePlannedStep>[0] = { cwd: workspacePath, runId, stepId };
  if (typeof args.command === "string") input.command = splitCommandLine(args.command);
  if (typeof args.attemptId === "string") input.attemptId = args.attemptId;
  const preview = buildRunExecutionPreview({ cwd: workspacePath, runId }).steps.find((step) => step.stepId === stepId);
  if (preview) {
    options.onProgress?.(
      progressLine({
        phase: "routing",
        status: "selected",
        stepId,
        model: preview.selectedModelId,
        providerModel: preview.selectedProviderModel,
        capability: preview.modelCapability,
        runner: preview.runner,
        isolation: preview.executionIsolation,
        reason: preview.executorSelectionReason ?? preview.routingReason.join(","),
        stepIndex: progressContext.stepIndex,
        stepCount: progressContext.stepCount,
      }),
      0,
    );
  }
  options.onProgress?.(
    progressLine({
      phase: "step",
      status: "started",
      stepId,
      stepIndex: progressContext.stepIndex,
      stepCount: progressContext.stepCount,
    }),
    0,
  );
  options.onProgress?.(
    progressLine({
      phase: "gate",
      status: ContractValues.Running,
      stepId,
      stepIndex: progressContext.stepIndex,
      stepCount: progressContext.stepCount,
    }),
  );
  let result: Awaited<ReturnType<typeof executePlannedStep>>;
  try {
    result = await executePlannedStep(input);
  } catch (error) {
    options.onProgress?.(
      progressLine({
        phase: "step",
        status: ContractValues.Failed,
        stepId,
        stepIndex: progressContext.stepIndex,
        stepCount: progressContext.stepCount,
        error: errorMessage(error),
      }),
      100,
    );
    throw error;
  }
  emitPostAttemptProgress({
    workspacePath,
    runId,
    stepId,
    attemptId: result.attemptId,
    options,
    stepIndex: progressContext.stepIndex,
    stepCount: progressContext.stepCount,
  });
  options.onProgress?.(
    progressLine({
      phase: "step",
      status: result.status,
      stepId,
      attemptId: result.attemptId,
      next: result.nextAction.type,
      runStatus: result.runStatus,
      stepIndex: progressContext.stepIndex,
      stepCount: progressContext.stepCount,
    }),
    100,
  );
  return {
    attemptId: result.attemptId,
    status: result.status,
    nextAction: result.nextAction,
    runStatus: result.runStatus,
    materializedDiff: result.materializedDiff,
  };
}

async function runStepTool(
  args: Record<string, unknown>,
  cwd: string,
  options: ToolCallOptions = {},
): Promise<unknown> {
  const runId = String(args.runId ?? "");
  const stepId = String(args.stepId ?? "");
  if (!runId || !stepId) throw new Error("kiwi_run_step requires runId and stepId");
  const workspace = workspaceArgs(args, cwd, false);

  return withRunLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: `mcp_run_step:${stepId}`,
    },
    async () => {
      const previewRecord = validateMcpPreviewToken({
        cwd: workspace.workspacePath,
        runId,
        previewToken: typeof args.previewToken === "string" ? args.previewToken : undefined,
        stepId,
      });
      if (previewRecord.executionIsolation === "direct") {
        assertMcpDirectExecutionSafe({
          workspacePath: workspace.workspacePath,
          repoPath: previewRecord.repoPath,
          runId,
        });
      }
      const result = await runStepToolUnlocked(args, workspace.workspacePath, options, { stepIndex: 1, stepCount: 1 });
      return withOperatorCard(
        {
          schemaVersion: "2",
          kind: "step_execution_result",
          runId,
          stepId,
          attempt: {
            attemptId: result.attemptId,
            status: result.status,
            nextAction: result.nextAction,
          },
          runStatus: result.runStatus,
          materializedDiff: result.materializedDiff,
        },
        {
          cwd: workspace.workspacePath,
          runId,
          lastAction: "kiwi_run_step",
          mutationScope: mutationScope({
            riskLabel: "MUTATES_WORKTREE",
            workspacePath: workspace.workspacePath,
            repoPath: workspace.repo?.path ?? null,
            executionMode: null,
          }),
        },
      );
    },
  );
}

async function runTool(
  args: Record<string, unknown>,
  cwd: string,
  callOptions: ToolCallOptions = {},
): Promise<unknown> {
  const runId = String(args.runId ?? "");
  if (!runId) throw new Error("kiwi_run requires runId");
  const workspace = workspaceArgs(args, cwd, false);
  const fromStep = typeof args.fromStep === "string" ? args.fromStep : undefined;
  const maxConcurrency = parseMaxConcurrency(args);
  if (maxConcurrency !== undefined && (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0)) {
    throw new Error(`kiwi_run maxConcurrency must be a positive integer; received ${maxConcurrency}`);
  }

  return withRunLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: "mcp_run",
    },
    async () => {
      const previewRecord = validateMcpPreviewToken({
        cwd: workspace.workspacePath,
        runId,
        previewToken: typeof args.previewToken === "string" ? args.previewToken : undefined,
        previewInput: normalizePreviewInput({ fromStep, maxConcurrency }),
      });
      if (previewRecord.executionIsolation === "direct") {
        assertMcpDirectExecutionSafe({
          workspacePath: workspace.workspacePath,
          repoPath: previewRecord.repoPath,
          runId,
        });
      }
      const taskGraph = loadTaskGraph(runId, workspace.workspacePath);
      const steps: RunStepToolResult[] = [];
      callOptions.onProgress?.(progressLine({ phase: "run", status: "started", runId }), 0);

      if (taskGraph.subPlans && taskGraph.subPlans.length > 1) {
        await runScheduledSubPlans<{ command?: string }>({
          cwd: workspace.workspacePath,
          runId,
          ...(fromStep ? { fromStep } : {}),
          ...(maxConcurrency !== undefined ? { maxGlobalConcurrency: maxConcurrency } : {}),
          attemptOptions: {
            ...(typeof args.command === "string" ? { command: args.command } : {}),
          },
          runStep: async (_scheduledRunId, stepId, attemptOptions) => {
            const stepIndex = steps.length + 1;
            steps.push(
              await runStepToolUnlocked(
                {
                  ...args,
                  workspacePath: workspace.workspacePath,
                  runId,
                  stepId,
                  ...attemptOptions,
                },
                workspace.workspacePath,
                callOptions,
                { stepIndex, stepCount: taskGraph.steps.length },
              ),
            );
          },
        });
      } else {
        const startIndex = fromStep ? taskGraph.steps.findIndex((step) => step.stepId === fromStep) : 0;
        if (startIndex < 0) throw new Error(`Step not found: ${fromStep}`);

        const selectedSteps = taskGraph.steps.slice(startIndex);
        for (const [index, step] of selectedSteps.entries()) {
          steps.push(
            await runStepToolUnlocked(
              {
                ...args,
                workspacePath: workspace.workspacePath,
                runId,
                stepId: step.stepId,
              },
              workspace.workspacePath,
              callOptions,
              { stepIndex: index + 1, stepCount: selectedSteps.length },
            ),
          );
          const status = getRunStatusSummary(workspace.workspacePath, runId).latest[0]?.currentStatus;
          if (status === ContractValues.Failed || status === "needs_approval") break;
        }
      }

      const run = getRunStatusSummary(workspace.workspacePath, runId).latest[0];
      callOptions.onProgress?.(progressLine({ phase: "run", status: run?.currentStatus ?? "missing", runId }), 100);
      return withOperatorCard(
        {
          schemaVersion: "2",
          kind: "run_execution_result",
          runId,
          status: run?.currentStatus ?? "missing",
          steps,
          summary: buildRunCompletionSummary({ cwd: workspace.workspacePath, runId }),
        },
        {
          cwd: workspace.workspacePath,
          runId,
          lastAction: "kiwi_run",
          mutationScope: mutationScope({
            riskLabel: "MUTATES_WORKTREE",
            workspacePath: workspace.workspacePath,
            repoPath: workspace.repo?.path ?? null,
            executionMode: null,
          }),
        },
      );
    },
  );
}

function callCoreTool(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
  workspacePath: string,
  repoPath: string | null,
  options: ToolCallOptions = {},
): Promise<unknown> | unknown | undefined {
  const runId = String(args.runId ?? "");
  switch (name) {
    case "kiwi_status": {
      const status = getRunStatusSummary(workspacePath, typeof args.runId === "string" ? args.runId : undefined);
      return typeof args.runId === "string"
        ? withOperatorCard(
            { schemaVersion: "2", kind: "run_status", status },
            { cwd: workspacePath, runId: args.runId, lastAction: "kiwi_status" },
          )
        : { schemaVersion: "2", kind: "run_status_list", status };
    }
    case "kiwi_preview_run":
      return previewRunTool(args, cwd);
    case "kiwi_run":
      return runTool(args, cwd, options);
    case "kiwi_run_step":
      return runStepTool(args, cwd, options);
    case "kiwi_diff":
      return withOperatorCard(
        {
          schemaVersion: "2",
          kind: "run_diff",
          diff: buildRunDiff({
            cwd: workspacePath,
            runId,
            ...(typeof args.stepId === "string" ? { stepId: args.stepId } : {}),
            ...(args.all === true ? { allAttempts: true } : {}),
          }),
        },
        { cwd: workspacePath, runId, lastAction: "kiwi_diff" },
      );
    case "kiwi_apply": {
      return withOperatorCard(
        {
          schemaVersion: "2",
          kind: "patch_apply_result",
          apply: applyRunDiff({
            cwd: workspacePath,
            runId,
            ...(typeof args.stepId === "string" ? { stepId: args.stepId } : {}),
          }),
        },
        {
          cwd: workspacePath,
          runId,
          lastAction: "kiwi_apply",
          mutationScope: mutationScope({
            riskLabel: "APPLIES_PATCH",
            workspacePath,
            repoPath,
            executionMode: null,
          }),
        },
      );
    }
    case "kiwi_finalize":
      return withRunLock({ cwd: workspacePath, runId, operation: "mcp_finalize" }, () => {
        options.onProgress?.(`finalize started runId=${runId}`, 0);
        const finalized = finalizeRun({ cwd: workspacePath, runId });
        options.onProgress?.(`finalize completed runId=${runId}`, 100);
        return withOperatorCard(
          {
            schemaVersion: "2",
            kind: "run_finalization_result",
            ...finalized,
            summary: buildRunCompletionSummary({ cwd: workspacePath, runId }),
          },
          {
            cwd: workspacePath,
            runId,
            lastAction: "kiwi_finalize",
            mutationScope: mutationScope({
              riskLabel: "WRITES_RUN_ARTIFACTS",
              workspacePath,
              repoPath,
              executionMode: null,
            }),
          },
        );
      });
    case "kiwi_cost":
      return withOperatorCard(
        { schemaVersion: "2", kind: "run_cost", summary: buildRunCompletionSummary({ cwd: workspacePath, runId }) },
        {
          cwd: workspacePath,
          runId,
          lastAction: "kiwi_cost",
        },
      );
    case "kiwi_explain":
      return withOperatorCard(
        {
          schemaVersion: "2",
          kind: "run_explanation",
          explanation: buildRunExplanation({ cwd: workspacePath, runId }),
        },
        {
          cwd: workspacePath,
          runId,
          lastAction: "kiwi_explain",
        },
      );
    case "kiwi_next":
      return nextTool(args, cwd);
    case "kiwi_request_approval":
      return withRunLock(
        {
          cwd: workspacePath,
          runId,
          operation: `mcp_approval:${String(args.attemptId ?? "")}`,
        },
        () =>
          withOperatorCard(
            {
              schemaVersion: "2",
              kind: "approval_result",
              approval: recordMcpApproval(args, workspacePath),
            },
            {
              cwd: workspacePath,
              runId,
              lastAction: "kiwi_request_approval",
              mutationScope: mutationScope({
                riskLabel: "WRITES_RUN_ARTIFACTS",
                workspacePath,
                repoPath,
                executionMode: null,
              }),
            },
          ),
      );
    case "kiwi_evidence_manifest":
      return withRunLock({ cwd: workspacePath, runId, operation: "mcp_evidence_manifest" }, () =>
        withOperatorCard(
          {
            schemaVersion: "2",
            kind: "evidence_manifest_result",
            manifest: writeEvidenceManifest({ cwd: workspacePath, runId }),
          },
          {
            cwd: workspacePath,
            runId,
            lastAction: "kiwi_evidence_manifest",
            mutationScope: mutationScope({
              riskLabel: "WRITES_RUN_ARTIFACTS",
              workspacePath,
              repoPath,
              executionMode: null,
            }),
          },
        ),
      );
    case "kiwi_operator_snapshot":
      return withRunLock({ cwd: workspacePath, runId, operation: "mcp_operator_snapshot" }, () =>
        withOperatorCard(
          {
            schemaVersion: "2",
            kind: "operator_snapshot_result",
            snapshot: writeOperatorSnapshot({ cwd: workspacePath, runId }),
          },
          {
            cwd: workspacePath,
            runId,
            lastAction: "kiwi_operator_snapshot",
            mutationScope: mutationScope({
              riskLabel: "WRITES_RUN_ARTIFACTS",
              workspacePath,
              repoPath,
              executionMode: null,
            }),
          },
        ),
      );
    case "kiwi_publish_pr_draft":
      options.onProgress?.(`publish pr draft started runId=${runId}`, 0);
      return Promise.resolve(publishPrDraftTool(args, workspacePath)).then((result) => {
        options.onProgress?.(`publish pr draft completed runId=${runId}`, 100);
        const payload = typeof result === "object" && result !== null && !Array.isArray(result) ? result : { result };
        return withOperatorCard(
          { schemaVersion: "2", kind: "pr_draft_publish_result", publish: payload },
          {
            cwd: workspacePath,
            runId,
            lastAction: "kiwi_publish_pr_draft",
            mutationScope: mutationScope({
              riskLabel: "PUSHES_BRANCH",
              workspacePath,
              repoPath,
              executionMode: null,
            }),
          },
        );
      });
    default:
      return undefined;
  }
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
  options: ToolCallOptions = {},
): Promise<unknown> {
  const validatedArgs = validateToolArguments(name, args);
  if (name === "kiwi_doctor") return doctorTool(validatedArgs, cwd);
  if (name === "kiwi_plan") return planTool(validatedArgs, cwd, options);
  const workspace = workspaceArgs(validatedArgs, cwd, false);
  const workspacePath = workspace.workspacePath;
  const coreResult = callCoreTool(name, validatedArgs, cwd, workspacePath, workspace.repo?.path ?? null, options);
  if (coreResult !== undefined) return coreResult;
  throw new Error(`Unknown tool: ${name}`);
}
