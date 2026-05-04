import { existsSync, mkdtempSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Initiative, Step } from "@ai-kiwi/contracts";
import { savePlannedRun } from "../run-store";
import { scheduleStepAttempt } from "../scheduler-policy";
import {
  assertStepDependenciesCompleted,
  finalizeRun,
  listStepAttemptEvidence,
  recordApprovalDecision,
  refreshRunStatusFromAttempts,
} from "../lifecycle";
import {
  StepAttemptOrchestrator,
  StepAttemptRunner,
  StepRunnerExecutionInput,
  StepRunnerExecutionOutput,
} from "../step-attempt-orchestrator";
import { GateResultSchema } from "@ai-kiwi/contracts";

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

function createRun(repo: string, steps: Step[] = [step]): void {
  savePlannedRun({
    cwd: repo,
    runId: "run_demo",
    initiative,
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
    expect(
      existsSync(path.join(repo, ".kiwi", "runs", "run_demo", "approvals", "attempt_001.json")),
    ).toBe(true);
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
    expect(
      readFileSync(path.join(repo, ".kiwi", "runs", "run_demo", "final", "final-summary.md"), "utf-8"),
    ).toContain("safeToApply: true");
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
});
