import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { GateResultSchema, Initiative, KiwiPolicy, Step } from "@kiwi/contracts";
import {
  assertStepDependenciesCompleted,
  listStepAttemptEvidence,
  recordApprovalDecision,
  refreshRunStatusFromAttempts,
  savePlannedRun,
} from "@kiwi/core";
import { scheduleStepAttempt } from "../scheduler-policy";
import { finalizeRun } from "../lifecycle/finalize";
import {
  StepAttemptOrchestrator,
  StepAttemptRunner,
  StepRunnerExecutionInput,
  StepRunnerExecutionOutput,
} from "../step-attempt-orchestrator";

function cwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-lifecycle-"));
}

const initiative: Initiative = {
  id: "init_demo",
  title: "Demo",
  rawInput: "# Demo",
  source: "cli",
  repoPath: "/tmp/repo",
  riskProfile: "dev",
  budgetProfile: "normal",
  createdAt: "2026-05-04T08:00:00.000Z",
};

const step: Step = {
  stepId: "step_001",
  type: "coding",
  title: "Implement",
  dependsOn: [],
  successCriteria: ["Done"],
  requiredGates: ["tests"],
  recommendedAgentRole: "executor",
  recommendedModelCapability: "strong",
  status: "pending",
};

const dependentStep: Step = {
  ...step,
  stepId: "step_002",
  title: "Second",
  dependsOn: ["step_001"],
};

class PassRunner implements StepAttemptRunner {
  readonly name = "local-shell";

  async execute(input: StepRunnerExecutionInput): Promise<StepRunnerExecutionOutput> {
    return {
      status: "completed",
      artifactRefs: [],
      rawLogsRef: null,
      modelUsage: { inputTokens: 0, outputTokens: 0 },
      gateResult: GateResultSchema.parse({
        gateId: "gate_tests",
        gateType: "tests",
        status: "pass",
        evidenceRefs: [],
        reason: `passed ${input.stepId}`,
      }),
    };
  }
}

class DiffRunner extends PassRunner {
  override async execute(input: StepRunnerExecutionInput): Promise<StepRunnerExecutionOutput> {
    const artifactsDir = path.join(
      input.workspacePath,
      ".kiwi",
      "runs",
      input.runId,
      "steps",
      input.stepId,
      input.attemptId,
      "artifacts",
    );
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      path.join(artifactsDir, "diff.patch"),
      "diff --git a/src/auth/service.ts b/src/auth/service.ts\n--- a/src/auth/service.ts\n+++ b/src/auth/service.ts\n@@ -0,0 +1 @@\n+ok\n",
      "utf-8",
    );
    return super.execute(input);
  }
}

function createRun(repo: string, steps: Step[] = [step], runInitiative: Initiative = initiative): void {
  savePlannedRun({
    cwd: repo,
    runId: "run_demo",
    initiative: runInitiative,
    taskGraph: {
      planId: "plan_demo",
      runId: "run_demo",
      initiativeId: "init_demo",
      summary: "Demo",
      steps,
      acceptanceCriteria: ["Done"],
      assumptions: [],
      openQuestions: [],
      riskScore: 2,
      complexityScore: 1,
      createdAt: "2026-05-04T08:00:00.000Z",
    },
    now: new Date("2026-05-04T08:00:00.000Z"),
  });
}

const highRiskPolicy: KiwiPolicy = {
  version: "1",
  project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
  commands: { test: "node -e 0", lint: "node -e 0", typecheck: "node -e 0" },
  routing: { defaultAgentRole: "executor", defaultModelCapability: "mid", stepTypeOverrides: {} },
  riskZones: { high: ["src/auth/**"] },
  approvals: { requireFor: [], commandApprovalStates: {} },
  commandProfiles: {
    default: {
      allowedCommands: ["node"],
      approvalState: "auto",
      approvalRequiredPaths: [],
      deniedPaths: [".env*", "secrets/**"],
      envAllowlist: ["PATH"],
      secretEnvNames: [],
      networkPolicy: "disabled",
      timeoutMs: 1000,
      maxOutputBytes: 4096,
    },
    coding: {
      allowedCommands: ["node"],
      approvalState: "auto",
      approvalRequiredPaths: [],
      deniedPaths: [".env*", "secrets/**"],
      envAllowlist: ["PATH"],
      secretEnvNames: [],
      networkPolicy: "disabled",
      timeoutMs: 1000,
      maxOutputBytes: 4096,
    },
  },
};

describe("run lifecycle", () => {
  it("records approval decisions", () => {
    const repo = cwd();
    createRun(repo);

    const decision = recordApprovalDecision({
      cwd: repo,
      runId: "run_demo",
      attemptId: "attempt_001",
      reason: "safe",
      approvedBy: "tester",
      now: new Date("2026-05-04T08:01:00.000Z"),
    });

    expect(decision.state).toBe("auto");
    expect(existsSync(path.join(repo, ".kiwi", "runs", "run_demo", "approvals", "attempt_001.json"))).toBe(true);
  });

  it("scans attempts, refreshes status, and finalizes run artifacts", async () => {
    const repo = cwd();
    createRun(repo);
    const decision = scheduleStepAttempt({
      cwd: repo,
      runId: "run_demo",
      step,
      initiative,
      budgetProfile: "normal",
      budgetRemainingUsdEstimate: null,
      blastRadius: "low",
      securitySensitivity: "low",
      contextSize: "small",
      runnerAvailability: ["local-shell"],
      attemptId: "attempt_001",
      now: new Date("2026-05-04T08:01:00.000Z"),
    });

    await new StepAttemptOrchestrator().execute({
      cwd: repo,
      step,
      schedulerDecision: decision,
      runner: new PassRunner(),
      worktreePath: path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_001"),
      stepPrompt: "ok",
      now: new Date("2026-05-04T08:02:00.000Z"),
    });

    const attempts = listStepAttemptEvidence(repo, "run_demo");
    expect(attempts).toHaveLength(1);
    const refreshed = refreshRunStatusFromAttempts({
      cwd: repo,
      runId: "run_demo",
      now: new Date("2026-05-04T08:03:00.000Z"),
    });
    expect(refreshed.status).toBe("completed");

    const finalized = finalizeRun({
      cwd: repo,
      runId: "run_demo",
      now: new Date("2026-05-04T08:04:00.000Z"),
    });
    expect(finalized.verdict.verdict).toBe("pass");
    expect(finalized.run.status).toBe("completed");
    expect(finalized.modelUsageSummaryRef).toBe("final/model-usage-summary.json");
    expect(readFileSync(path.join(repo, ".kiwi", "runs", "run_demo", "final", "final-summary.md"), "utf-8")).toContain(
      "modelUsageSummary: final/model-usage-summary.json",
    );
    const usageSummary = JSON.parse(
      readFileSync(path.join(repo, ".kiwi", "runs", "run_demo", "final", "model-usage-summary.json"), "utf-8"),
    ) as { invocationCount: number; byPhase: { executor: { inputTokens: number }; reviewer: { inputTokens: number } } };
    expect(usageSummary.invocationCount).toBe(2);
    expect(usageSummary.byPhase.executor.inputTokens).toBe(0);
    expect(usageSummary.byPhase.reviewer.inputTokens).toBe(0);
  });

  it("requires dependency steps to have completed attempts", async () => {
    const repo = cwd();
    createRun(repo, [step, dependentStep]);

    expect(() =>
      assertStepDependenciesCompleted({
        cwd: repo,
        runId: "run_demo",
        stepId: dependentStep.stepId,
        dependsOn: dependentStep.dependsOn,
      }),
    ).toThrow("Cannot execute step_002 before dependencies complete: step_001");

    const decision = scheduleStepAttempt({
      cwd: repo,
      runId: "run_demo",
      step,
      initiative,
      budgetProfile: "normal",
      budgetRemainingUsdEstimate: null,
      blastRadius: "low",
      securitySensitivity: "low",
      contextSize: "small",
      runnerAvailability: ["local-shell"],
      attemptId: "attempt_001",
      now: new Date("2026-05-04T08:05:00.000Z"),
    });

    await new StepAttemptOrchestrator().execute({
      cwd: repo,
      step,
      schedulerDecision: decision,
      runner: new PassRunner(),
      worktreePath: path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_001"),
      stepPrompt: "ok",
      now: new Date("2026-05-04T08:06:00.000Z"),
    });

    expect(() =>
      assertStepDependenciesCompleted({
        cwd: repo,
        runId: "run_demo",
        stepId: dependentStep.stepId,
        dependsOn: dependentStep.dependsOn,
      }),
    ).not.toThrow();
  });

  it("blocks safeToApply when diff evidence is not bound to gate and review hashes", async () => {
    const repo = cwd();
    createRun(repo);
    const decision = scheduleStepAttempt({
      cwd: repo,
      runId: "run_demo",
      step,
      initiative,
      budgetProfile: "normal",
      budgetRemainingUsdEstimate: null,
      blastRadius: "low",
      securitySensitivity: "low",
      contextSize: "small",
      runnerAvailability: ["local-shell"],
      attemptId: "attempt_001",
      now: new Date("2026-05-04T08:10:00.000Z"),
    });

    await new StepAttemptOrchestrator().execute({
      cwd: repo,
      step,
      schedulerDecision: decision,
      runner: new PassRunner(),
      worktreePath: path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_001"),
      stepPrompt: "ok",
      now: new Date("2026-05-04T08:11:00.000Z"),
    });
    writeFileSync(
      path.join(repo, ".kiwi", "runs", "run_demo", "steps", "step_001", "attempt_001", "artifacts", "diff.patch"),
      "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1 @@\n+ok\n",
      "utf-8",
    );

    const finalized = finalizeRun({
      cwd: repo,
      runId: "run_demo",
      now: new Date("2026-05-04T08:12:00.000Z"),
    });

    expect(finalized.verdict.safeToApply).toBe(false);
    expect(finalized.verdict.reason).toContain("not bound to current diff hash");
  });

  it("executes and finalizes scheduler-required risk gates", async () => {
    const repo = cwd();
    const productionInitiative: Initiative = { ...initiative, riskProfile: "production", budgetProfile: "tiny" };
    createRun(repo, [step], productionInitiative);
    const decision = scheduleStepAttempt({
      cwd: repo,
      runId: "run_demo",
      step,
      initiative: productionInitiative,
      budgetProfile: "tiny",
      budgetRemainingUsdEstimate: 0,
      blastRadius: "high",
      securitySensitivity: "high",
      contextSize: "small",
      runnerAvailability: ["local-shell"],
      attemptId: "attempt_risk",
      now: new Date("2026-05-04T08:20:00.000Z"),
    });

    await new StepAttemptOrchestrator().execute({
      cwd: repo,
      step,
      schedulerDecision: decision,
      runner: new DiffRunner(),
      worktreePath: path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_risk"),
      stepPrompt: "ok",
      policy: highRiskPolicy,
      now: new Date("2026-05-04T08:21:00.000Z"),
    });

    const attempts = listStepAttemptEvidence(repo, "run_demo");
    expect(attempts[0]?.gateResults.map((gate) => gate.gateType)).toEqual([
      "tests",
      "forbidden_file_checks",
      "secrets_check",
    ]);

    const finalized = finalizeRun({
      cwd: repo,
      runId: "run_demo",
      now: new Date("2026-05-04T08:22:00.000Z"),
    });
    expect(finalized.verdict.safeToApply).toBe(false);
    expect(finalized.verdict.reason).toContain("gate gate_forbidden_file_checks is fail");
  });
});
