import { mkdirSync, mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { readAuditEvents } from "@kiwi/core";
import { ContractValues, ExecutionIsolations, NextActionTypes, RunnerNames, type Step, type TaskGraph } from "@kiwi/contracts";
import { ProviderFailureCodes } from "@kiwi/adapters";
import { ExecutionRunContext } from "../../execution/planned-steps/context.js";
import { PlannedStepExecutionService } from "../../execution/planned-steps/service.js";
import type { ExecutionMode, RunAttemptResult } from "../../execution/planned-steps/types.js";
import type { StepExecutionSession } from "../../execution/planned-steps/session.js";

const step: Step = {
  stepId: "step_001",
  type: "coding",
  title: "Implement",
  dependsOn: [],
  successCriteria: ["Done"],
  requiredGates: [],
  recommendedAgentRole: ContractValues.Executor,
  recommendedModelCapability: ContractValues.Strong,
  status: ContractValues.Pending,
};

const taskGraph: TaskGraph = {
  planId: "plan_demo",
  runId: "run_demo",
  initiativeId: "init_demo",
  summary: "Demo",
  steps: [step],
  acceptanceCriteria: ["Done"],
  assumptions: [],
  openQuestions: [],
  riskScore: 1,
  complexityScore: 1,
  createdAt: "2026-05-04T08:00:00.000Z",
};

function cwd(): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), "kiwi-planned-fallback-"));
  mkdirSync(path.join(repo, ".kiwi", "logs"), { recursive: true });

  return repo;
}

function attemptResult(params: {
  runner: string;
  attemptId: string;
  status: "completed" | "failed";
  error?: { code: string; message: string };
}): RunAttemptResult {
  return {
    result: {
      runId: "run_demo",
      stepId: "step_001",
      attemptId: params.attemptId,
      status: params.status,
      runnerStatus: params.status,
      artifactRefs: [],
      gateResults: [],
      gateResultsRef: "gate-results.json",
      reviewVerdict: {
        verdict: params.status === ContractValues.Completed ? ContractValues.Pass : ContractValues.Reject,
        safeToContinue: params.status === ContractValues.Completed,
        issues: [],
        recommendedNextSteps: [],
        confidence: 1,
      },
      reviewReportRef: "review.json",
      attemptRef: "attempt.json",
      nextAction: {
        type: params.status === ContractValues.Completed ? NextActionTypes.Continue : NextActionTypes.Replan,
        reason: params.runner,
        recommendedNextSteps: [],
        issueCodes: [],
      },
      ...(params.error ? { error: params.error } : {}),
    },
    materializedDiff: { status: "skipped", reason: "test" },
  };
}

describe("planned step provider fallback", () => {
  it("retries a provider-rate-limited runner with the next available runner", async () => {
    const repo = cwd();
    const runnerResolution = {
      runnerAvailability: [RunnerNames.ClaudeCode, RunnerNames.Codex],
      runnerAvailabilityDetails: [],
      selectedExecutorModel: null,
      executorSelection: {
        model: null,
        requestedCapability: ContractValues.Strong,
        selectedCapability: null,
        reason: "no_model_available",
      },
      selectExecutorModel: () => ({
        model: null,
        requestedCapability: ContractValues.Strong,
        selectedCapability: null,
        reason: "no_model_available",
      }),
      selectExecutorModelForRunner: (runner: string) => ({
        model:
          runner === RunnerNames.Codex
            ? {
                id: "codex-strong",
                provider: "local" as const,
                capability: ContractValues.Strong,
                roles: [ContractValues.Executor],
                enabled: true,
                accessMode: "codex-cli" as const,
                providerModel: "gpt-5.4",
                pricing: { currency: "USD" as const, inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
              }
            : {
                id: "claude-strong",
                provider: "anthropic" as const,
                capability: ContractValues.Strong,
                roles: [ContractValues.Executor],
                enabled: true,
                accessMode: "claude-code-cli" as const,
                providerModel: "claude-sonnet",
                pricing: { currency: "USD" as const, inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
              },
        requestedCapability: ContractValues.Strong,
        selectedCapability: ContractValues.Strong,
        reason: "exact_match",
      }),
      buildAdapter: () => {
        throw new Error("not used");
      },
    };
    let attemptCount = 0;
    const service = new PlannedStepExecutionService(
      {
        load: () =>
          new ExecutionRunContext(
            repo,
            "run_demo",
            new Date("2026-05-04T08:00:00.000Z"),
            {
              version: "1",
              project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
              commands: { test: "node -e 0", lint: "node -e 0", typecheck: "node -e 0" },
              routing: {
                defaultAgentRole: ContractValues.Executor,
                defaultModelCapability: ContractValues.Mid,
                providerPreference: {},
                stepTypeOverrides: {},
              },
              riskZones: { high: [] },
              approvals: { requireFor: [], commandApprovalStates: {} },
              commandProfiles: {},
            },
            {
              version: "1",
              models: [],
            },
            {
              id: "init_demo",
              title: "Demo",
              rawInput: "Demo",
              source: "cli",
              repoPath: repo,
              riskProfile: "dev",
              budgetProfile: "normal",
              createdAt: "2026-05-04T08:00:00.000Z",
            },
            taskGraph,
          ),
        assertStepReady: () => undefined,
      } as never,
      {
        executionMode: () => ExecutionIsolations.Worktree,
        directExecutionMode: ExecutionIsolations.Direct,
        codexSandbox: () => "workspace-write",
      } as never,
      {
        approvals: { loadLatestForStep: () => null },
        evidence: {
          listStepAttempts: () => [],
          latestAttemptByStep: () => new Map(),
        },
        runStatus: { refreshFromAttempts: () => ({ status: ContractValues.Completed }) },
      } as never,
      {
        resolveRunnerResolution: () => runnerResolution,
        select: (session: StepExecutionSession) => {
          const selection = runnerResolution.selectExecutorModelForRunner(session.decision.runner ?? RunnerNames.ClaudeCode);

          session.setRunnerSelection({
            runnerAdapter: {
              name: session.decision.runner ?? RunnerNames.ClaudeCode,
              execute: async () => ({
                status: ContractValues.Completed,
                artifactRefs: [],
                rawLogsRef: null,
                modelUsage: { inputTokens: 0, outputTokens: 0 },
                gateResult: {
                  gateId: "gate_runner_execution",
                  gateType: "diff_required",
                  status: "pass",
                  evidenceRefs: [],
                  reason: "unused",
                },
              }),
            },
            selectedModel: selection.model,
            selectedModelId: selection.model.id,
            executorSelectionReason: selection.reason,
          });
        },
      } as never,
      {
        schedule: (session: StepExecutionSession) => {
          attemptCount += 1;
          const runner = session.runnerResolution?.runnerAvailability[0] ?? RunnerNames.ClaudeCode;
          const decision = {
            status: "scheduled",
            runId: "run_demo",
            stepId: "step_001",
            attemptId: session.input.attemptId ?? `attempt_00${attemptCount}`,
            agentRole: ContractValues.Executor,
            modelCapability: ContractValues.Strong,
            runner,
            requiredGates: [],
            reviewDepth: ContractValues.Strong,
            contextLevel: "L0",
            routingReason: [],
          };

          session.setDecision(decision as never);

          return decision;
        },
        enrich: (session: StepExecutionSession, isolation: ExecutionMode) => {
          const decision = {
            ...session.decision,
            executionIsolation: isolation,
            executionOwner: "kiwi-codex-cli",
            selectedModelId: session.runnerSelection.selectedModelId,
            selectedProviderModel: session.runnerSelection.selectedModel?.providerModel ?? null,
            selectedAccessMode: session.runnerSelection.selectedModel?.accessMode ?? null,
          };

          session.setEnrichedDecision(decision as never);

          return decision;
        },
      } as never,
      {
        create: (_params: unknown) => ({
          mode: ExecutionIsolations.Worktree,
          runId: "run_demo",
          attemptId: "attempt",
          worktreePath: path.join(repo, "worktree"),
          sourcePath: repo,
          isolation: ExecutionIsolations.Worktree,
          diffBaseTree: null,
        }),
        teardown: () => undefined,
      } as never,
      {
        execute: async (session: StepExecutionSession) =>
          session.enrichedDecision.runner === RunnerNames.ClaudeCode
            ? attemptResult({
                runner: RunnerNames.ClaudeCode,
                attemptId: session.enrichedDecision.attemptId,
                status: ContractValues.Failed,
                error: {
                  code: ProviderFailureCodes.RateLimited,
                  message: "claude-code provider rate limited (HTTP 429): You've hit your limit",
                },
              })
            : attemptResult({
                runner: RunnerNames.Codex,
                attemptId: session.enrichedDecision.attemptId,
                status: ContractValues.Completed,
              }),
      } as never,
    );

    const result = await service.execute({ cwd: repo, runId: "run_demo", stepId: "step_001" });

    expect(result.status).toBe(ContractValues.Completed);
    expect(result.attemptId).toContain("_fallback_");
    expect(result.fallback).toMatchObject({
      failedRunner: RunnerNames.ClaudeCode,
      replacementRunner: RunnerNames.Codex,
      replacementModelId: "codex-strong",
    });
    expect(readAuditEvents(repo, "run_demo").map((event) => event.eventType)).toContain("provider_fallback_selected");
  });
});
