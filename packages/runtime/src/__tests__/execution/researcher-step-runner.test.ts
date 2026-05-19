import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { KiwiPolicy, ModelEntry } from "@kiwi/contracts";
import { ensureRunLayout, writeJsonSafely } from "@kiwi/core";
import { StubResearcherProvider } from "@kiwi/adapters";
import { LocalResearchStepRunner, ResearcherStepRunner } from "../../execution/researcher-step-runner.js";

const policy: KiwiPolicy = {
  version: "1",
  project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
  commands: { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
  routing: {
    defaultAgentRole: "executor",
    defaultModelCapability: "mid",
    providerPreference: {},
    stepTypeOverrides: {},
  },
  riskZones: { high: [] },
  approvals: { requireFor: [], commandApprovalStates: {} },
  commandProfiles: {},
};

const model: ModelEntry = {
  id: "stub-mid",
  provider: "stub",
  capability: "mid",
  roles: ["researcher"],
  accessMode: "stub",
  enabled: true,
  pricing: { currency: "USD", inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
};

function contextPackage(runId: string, attemptId: string) {
  return {
    runId,
    stepId: "step_001",
    attemptId,
    level: "L1" as const,
    initiative: {
      title: "Research auth",
      rawInput: "Research auth files",
      riskProfile: "dev",
      budgetProfile: "normal",
    },
    task: {
      stepId: "step_001",
      type: "context_discovery" as const,
      title: "Discover context",
      successCriteria: ["Research report written"],
      requiredGates: [],
      acceptanceCriteria: ["Research report written"],
    },
    mutationRequirement: "may_change_files" as const,
    files: [],
    commands: { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
    budget: {
      modelCapability: "mid" as const,
      contextLevel: "L1" as const,
      selectedModelId: "stub-mid",
      selectedProviderModel: null,
      estimatedAttemptCostUsd: 0,
    },
    include: {
      initiative: true,
      policy: true,
      registry: true,
      commands: true,
      relevantFiles: ["src/auth.ts"],
      tests: [],
      recentDiffFiles: [],
      symbolHits: [],
      traces: [],
      architectureFiles: [],
      historicalOutcomeRefs: [],
    },
    retrieval: { strategyVersion: "test", files: [] },
    generatedAt: "2026-05-06T12:00:00.000Z",
  };
}

describe("ResearcherStepRunner", () => {
  it("can complete local-first research without an external provider", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kiwi-local-research-runner-"));
    const runId = "run_20260506_120000_local";
    ensureRunLayout(runId, cwd);
    writeJsonSafely(path.join(cwd, ".kiwi", "runs", runId, "initiative.json"), {
      id: "init_20260506_120000_local",
      title: "Research auth",
      rawInput: "Research auth files",
      source: "cli",
      repoPath: cwd,
      riskProfile: "dev",
      budgetProfile: "normal",
      createdAt: "2026-05-06T12:00:00.000Z",
    });

    const runner = new LocalResearchStepRunner(policy);
    const result = await runner.execute({
      runId,
      stepId: "step_001",
      attemptId: "attempt_local",
      workspacePath: cwd,
      repoPath: cwd,
      worktreePath: path.join(cwd, ".kiwi", "worktrees", "attempt_local"),
      step: {
        stepId: "step_001",
        type: "context_discovery",
        title: "Discover context",
        successCriteria: ["Research report written"],
        requiredGates: [],
      },
      contextPackage: contextPackage(runId, "attempt_local"),
      allowedTools: [],
      timeouts: { commandTimeoutMs: 120_000 },
      requestedAt: "2026-05-06T12:00:00.000Z",
    });

    expect(result.status).toBe("completed");
    expect(result.providerName).toBe("local-research");
    expect(result.modelId).toBe("local-researcher");
    const reportPath = path.join(cwd, ".kiwi", "runs", runId, "plan", "research-report.json");
    expect(JSON.parse(readFileSync(reportPath, "utf-8")).relevantFiles[0].path).toBe("src/auth.ts");
  });

  it("writes research report and links it from planner input", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kiwi-research-runner-"));
    const runId = "run_20260506_120000_abcd";
    ensureRunLayout(runId, cwd);
    writeJsonSafely(path.join(cwd, ".kiwi", "runs", runId, "initiative.json"), {
      id: "init_20260506_120000_abcd",
      title: "Research auth",
      rawInput: "Research auth files",
      source: "cli",
      repoPath: cwd,
      riskProfile: "dev",
      budgetProfile: "normal",
      createdAt: "2026-05-06T12:00:00.000Z",
    });
    writeJsonSafely(path.join(cwd, ".kiwi", "runs", runId, "plan", "planner-input.json"), {
      promptVersion: "planner.v1",
    });

    const runner = new ResearcherStepRunner(new StubResearcherProvider(), model, policy, "stub");
    const result = await runner.execute({
      runId,
      stepId: "step_001",
      attemptId: "attempt_20260506120000000",
      workspacePath: cwd,
      repoPath: cwd,
      worktreePath: path.join(cwd, ".kiwi", "worktrees", "attempt_20260506120000000"),
      step: {
        stepId: "step_001",
        type: "context_discovery",
        title: "Discover context",
        successCriteria: ["Research report written"],
        requiredGates: [],
      },
      contextPackage: contextPackage(runId, "attempt_20260506120000000"),
      allowedTools: [],
      timeouts: { commandTimeoutMs: 120_000 },
      requestedAt: "2026-05-06T12:00:00.000Z",
    });

    expect(result.status).toBe("completed");
    const reportPath = path.join(cwd, ".kiwi", "runs", runId, "plan", "research-report.json");
    expect(existsSync(reportPath)).toBe(true);
    expect(JSON.parse(readFileSync(reportPath, "utf-8")).relevantFiles[0].path).toBe("src/auth.ts");
    const plannerInput = JSON.parse(
      readFileSync(path.join(cwd, ".kiwi", "runs", runId, "plan", "planner-input.json"), "utf-8"),
    );
    expect(plannerInput.researchReportRef).toBe("plan/research-report.json");
  });
});
