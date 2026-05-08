import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Artifact, GateResultSchema, Initiative, ReviewVerdictSchema, Step } from "@kiwi/contracts";
import { readAuditEvents, readModelInvocations } from "@kiwi/core";
import { ReviewEngine } from "../review-engine";
import { loadSchedulerDecision, scheduleStepAttempt } from "../scheduler-policy";
import {
  StepAttemptOrchestrator,
  StepAttemptRunner,
  StepRunnerExecutionInput,
  StepRunnerExecutionOutput,
} from "../step-attempt-orchestrator";

function cwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-step-orchestrator-"));
}

function fixtureStep(overrides: Partial<Step> = {}): Step {
  return {
    stepId: "step_001",
    type: "coding",
    title: "Implement feature",
    dependsOn: [],
    successCriteria: ["Feature implemented"],
    requiredGates: ["tests"],
    recommendedAgentRole: "executor",
    recommendedModelCapability: "strong",
    status: "pending",
    ...overrides,
  };
}

function fixtureInitiative(overrides: Partial<Initiative> = {}): Initiative {
  return {
    id: "init_demo",
    title: "Demo Initiative",
    rawInput: "# Demo",
    source: "cli",
    repoPath: "/tmp/repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-04T06:00:00.000Z",
    ...overrides,
  };
}

function schedule(repo: string, attemptId: string, overrides: Partial<Parameters<typeof scheduleStepAttempt>[0]> = {}) {
  return scheduleStepAttempt({
    cwd: repo,
    runId: "run_demo",
    step: fixtureStep(),
    initiative: fixtureInitiative(),
    budgetProfile: "normal",
    budgetRemainingUsdEstimate: null,
    blastRadius: "low",
    securitySensitivity: "low",
    contextSize: "small",
    runnerAvailability: ["local-shell"],
    now: new Date("2026-05-04T06:00:00.000Z"),
    attemptId,
    ...overrides,
  });
}

function commandOutputArtifact(input: StepRunnerExecutionInput): Artifact {
  const ref = `steps/${input.stepId}/${input.attemptId}/artifacts/command-output.json`;
  const target = path.join(input.workspacePath, ".kiwi", "runs", input.runId, ref);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    JSON.stringify({
      command: ["sample"],
      status: "completed",
      stdout: "ok",
      stderr: "",
    }),
    "utf-8",
  );
  return {
    type: "command_output",
    ref,
    createdAt: "2026-05-04T06:00:01.000Z",
  };
}

function diffArtifact(input: StepRunnerExecutionInput): Artifact {
  const ref = `steps/${input.stepId}/${input.attemptId}/artifacts/diff.patch`;
  const target = path.join(input.workspacePath, ".kiwi", "runs", input.runId, ref);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    "diff --git a/feature.txt b/feature.txt\n--- a/feature.txt\n+++ b/feature.txt\n@@ -0,0 +1 @@\n+safe sample\n",
    "utf-8",
  );
  return {
    type: "diff",
    ref,
    createdAt: "2026-05-04T06:00:01.000Z",
  };
}

class SafeSampleRunner implements StepAttemptRunner {
  readonly name = "local-shell";

  async execute(input: StepRunnerExecutionInput): Promise<StepRunnerExecutionOutput> {
    mkdirSync(input.worktreePath, { recursive: true });
    writeFileSync(path.join(input.worktreePath, "feature.txt"), input.stepPrompt, "utf-8");
    const outputArtifact = commandOutputArtifact(input);

    return {
      status: "completed",
      artifactRefs: [outputArtifact],
      rawLogsRef: outputArtifact.ref,
      modelUsage: {
        inputTokens: 12,
        outputTokens: 3,
      },
      gateResult: GateResultSchema.parse({
        gateId: "gate_command_execution",
        gateType: "tests",
        status: "pass",
        evidenceRefs: [outputArtifact.ref],
        reason: "Sample step passed",
      }),
    };
  }
}

class DiffSampleRunner extends SafeSampleRunner {
  override async execute(input: StepRunnerExecutionInput): Promise<StepRunnerExecutionOutput> {
    const output = await super.execute(input);
    return {
      ...output,
      artifactRefs: [...output.artifactRefs, diffArtifact(input)],
    };
  }
}

class FailingRunner implements StepAttemptRunner {
  readonly name = "local-shell";

  async execute(input: StepRunnerExecutionInput): Promise<StepRunnerExecutionOutput> {
    const outputArtifact = commandOutputArtifact(input);
    return {
      status: "failed",
      artifactRefs: [outputArtifact],
      rawLogsRef: outputArtifact.ref,
      modelUsage: {
        inputTokens: 1,
        outputTokens: 1,
      },
      gateResult: GateResultSchema.parse({
        gateId: "gate_command_execution",
        gateType: "tests",
        status: "fail",
        evidenceRefs: [outputArtifact.ref],
        reason: "Sample step failed",
      }),
      error: {
        code: "RUNNER_FAILED",
        message: "Sample step failed",
      },
    };
  }
}

class UnsafePositiveReviewEngine implements ReviewEngine {
  readonly name = "unsafe-positive-review";

  async review() {
    return ReviewVerdictSchema.parse({
      verdict: "pass",
      safeToContinue: true,
      issues: [],
      recommendedNextSteps: ["Continue"],
      confidence: 0.5,
    });
  }
}

class ThrowingReviewEngine implements ReviewEngine {
  readonly name = "throwing-review";

  async review(): Promise<never> {
    throw new Error("review provider returned invalid JSON");
  }
}

describe("step attempt orchestrator", () => {
  it("executes a safe sample coding step with auditable artifacts", async () => {
    const repo = cwd();
    const decision = schedule(repo, "attempt_001");
    const worktreePath = path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_001");
    const result = await new StepAttemptOrchestrator().execute({
      cwd: repo,
      step: fixtureStep(),
      schedulerDecision: decision,
      runner: new SafeSampleRunner(),
      worktreePath,
      stepPrompt: "safe sample",
      now: new Date("2026-05-04T06:00:01.000Z"),
    });

    expect(result.status).toBe("completed");
    expect(result.nextAction.type).toBe("continue");
    expect(result.reviewVerdict.verdict).toBe("pass");
    expect(existsSync(path.join(worktreePath, "feature.txt"))).toBe(true);
    expect(existsSync(path.join(repo, "feature.txt"))).toBe(false);
    expect(result.artifactRefs.map((entry) => entry.type)).toEqual([
      "command_output",
      "review_report",
      "cost_report",
      "summary",
    ]);

    const attempt = JSON.parse(
      readFileSync(
        path.join(repo, ".kiwi", "runs", "run_demo", "steps", "step_001", "attempt_001", "attempt.json"),
        "utf-8",
      ),
    ) as { status: string; artifacts: Artifact[]; modelInvocationRefs: string[] };
    expect(attempt.status).toBe("completed");
    expect(attempt.artifacts).toHaveLength(4);
    expect(attempt.modelInvocationRefs).toHaveLength(2);
    const invocations = readModelInvocations(repo, "run_demo");
    expect(invocations.map((entry) => entry.phase)).toEqual(["executor", "reviewer"]);
    expect(invocations[0]?.providerName).toBe("local");
    expect(invocations[0]?.modelId).toBeNull();
    expect(invocations[1]?.providerName).toBe("stub");
    expect(invocations[1]?.modelId).toBe("stub-reviewer");
    const costReport = JSON.parse(
      readFileSync(
        path.join(
          repo,
          ".kiwi",
          "runs",
          "run_demo",
          "steps",
          "step_001",
          "attempt_001",
          "artifacts",
          "cost-report.json",
        ),
        "utf-8",
      ),
    ) as { providerName: string; modelId: string | null; modelInvocationRefs: string[] };
    expect(costReport.providerName).toBe("local");
    expect(costReport.modelId).toBeNull();
    expect(costReport.modelInvocationRefs).toHaveLength(2);
    expect(
      existsSync(path.join(repo, ".kiwi", "runs", "run_demo", "steps", "step_001", "attempt_001", "gate-results.json")),
    ).toBe(true);
    expect(
      existsSync(
        path.join(
          repo,
          ".kiwi",
          "runs",
          "run_demo",
          "steps",
          "step_001",
          "attempt_001",
          "artifacts",
          "review-report.json",
        ),
      ),
    ).toBe(true);

    const events = readAuditEvents(repo, "run_demo");
    expect(events.some((event) => event.eventType === "step_attempt_started")).toBe(true);
    expect(events.some((event) => event.eventType === "step_attempt_reviewed")).toBe(true);
    expect(events.some((event) => event.eventType === "step_attempt_next_action")).toBe(true);
  });

  it("does not accept a positive review when required gates fail", async () => {
    const repo = cwd();
    const decision = schedule(repo, "attempt_002");
    const result = await new StepAttemptOrchestrator().execute({
      cwd: repo,
      step: fixtureStep(),
      schedulerDecision: decision,
      runner: new FailingRunner(),
      worktreePath: path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_002"),
      stepPrompt: "failing sample",
      reviewEngine: new UnsafePositiveReviewEngine(),
      now: new Date("2026-05-04T06:00:01.000Z"),
    });

    expect(result.status).toBe("failed");
    expect(result.runnerStatus).toBe("failed");
    expect(result.reviewVerdict.verdict).toBe("needs_changes");
    expect(result.nextAction).toMatchObject({
      type: "fix_step",
      reason: "needs_changes",
      issueCodes: ["GATE_FAILURE"],
    });
    expect(result.error?.code).toBe("RUNNER_FAILED");
  });

  it("applies post-runner gate results before accepting review", async () => {
    const repo = cwd();
    const decision = schedule(repo, "attempt_004");
    const result = await new StepAttemptOrchestrator().execute({
      cwd: repo,
      step: fixtureStep(),
      schedulerDecision: decision,
      runner: new SafeSampleRunner(),
      worktreePath: path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_004"),
      stepPrompt: "safe sample with failing post gate",
      reviewEngine: new UnsafePositiveReviewEngine(),
      postRunnerGateExecutor: async () => ({
        gateResults: [
          GateResultSchema.parse({
            gateId: "gate_tests",
            gateType: "tests",
            status: "fail",
            evidenceRefs: ["steps/step_001/attempt_004/artifacts/tests.json"],
            reason: "post-run tests failed",
          }),
        ],
        artifacts: [
          {
            type: "test_report",
            ref: "steps/step_001/attempt_004/artifacts/tests.json",
            createdAt: "2026-05-04T06:00:02.000Z",
          },
        ],
      }),
      now: new Date("2026-05-04T06:00:01.000Z"),
    });

    expect(result.status).toBe("failed");
    expect(result.reviewVerdict.verdict).toBe("needs_changes");
    expect(result.gateResults.some((entry) => entry.gateId === "gate_tests" && entry.status === "fail")).toBe(true);
    expect(result.artifactRefs.some((entry) => entry.type === "test_report")).toBe(true);
  });

  it("marks the attempt failed when review execution throws", async () => {
    const repo = cwd();
    const decision = schedule(repo, "attempt_review_error");

    const result = await new StepAttemptOrchestrator().execute({
      cwd: repo,
      step: fixtureStep(),
      schedulerDecision: decision,
      runner: new DiffSampleRunner(),
      worktreePath: path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_review_error"),
      stepPrompt: "review failure sample",
      reviewEngine: new ThrowingReviewEngine(),
      now: new Date("2026-05-04T06:00:01.000Z"),
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({
      code: "REVIEW_EXECUTION_FAILED",
      message: "review provider returned invalid JSON",
    });
    expect(result.reviewVerdict).toMatchObject({
      verdict: "reject",
      safeToContinue: false,
    });

    const attempt = JSON.parse(
      readFileSync(
        path.join(repo, ".kiwi", "runs", "run_demo", "steps", "step_001", "attempt_review_error", "attempt.json"),
        "utf-8",
      ),
    ) as { status: string; completedAt: string | null; artifacts: Artifact[] };
    expect(attempt.status).toBe("failed");
    expect(attempt.completedAt).toBeTruthy();
    expect(attempt.artifacts.some((entry) => entry.type === "command_output")).toBe(true);
    expect(attempt.artifacts.some((entry) => entry.type === "review_report")).toBe(true);
    const invocations = readModelInvocations(repo, "run_demo");
    expect(invocations.at(-1)).toMatchObject({
      phase: "reviewer",
      providerName: "review-error",
      status: "failed",
    });
    const failedEvent = readAuditEvents(repo, "run_demo").find((event) => event.eventType === "step_attempt_failed");
    expect(failedEvent?.payload).toMatchObject({
      stepId: "step_001",
      attemptId: "attempt_review_error",
      phase: "review",
    });
  });

  it("uses deterministic review when a completed runner produced no diff", async () => {
    const repo = cwd();
    const decision = schedule(repo, "attempt_no_diff_review");

    const result = await new StepAttemptOrchestrator().execute({
      cwd: repo,
      step: fixtureStep(),
      schedulerDecision: decision,
      runner: new SafeSampleRunner(),
      worktreePath: path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_no_diff_review"),
      stepPrompt: "no diff sample",
      reviewEngine: new ThrowingReviewEngine(),
      now: new Date("2026-05-04T06:00:01.000Z"),
    });

    expect(result.status).toBe("completed");
    expect(result.reviewVerdict.verdict).toBe("pass");
    expect(result.error).toBeUndefined();
  });

  it("uses deterministic review when runner fails before provider review", async () => {
    const repo = cwd();
    const decision = schedule(repo, "attempt_runner_failed_before_review");

    const result = await new StepAttemptOrchestrator().execute({
      cwd: repo,
      step: fixtureStep(),
      schedulerDecision: decision,
      runner: new FailingRunner(),
      worktreePath: path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_runner_failed_before_review"),
      stepPrompt: "runner failure sample",
      reviewEngine: new ThrowingReviewEngine(),
      now: new Date("2026-05-04T06:00:01.000Z"),
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RUNNER_FAILED");
    expect(result.reviewVerdict.issues.map((issue) => issue.code)).toEqual(["GATE_FAILURE"]);
    const attempt = JSON.parse(
      readFileSync(
        path.join(
          repo,
          ".kiwi",
          "runs",
          "run_demo",
          "steps",
          "step_001",
          "attempt_runner_failed_before_review",
          "attempt.json",
        ),
        "utf-8",
      ),
    ) as { status: string; completedAt: string | null; artifacts: Artifact[] };
    expect(attempt.status).toBe("failed");
    expect(attempt.completedAt).toBeTruthy();
    expect(attempt.artifacts.some((entry) => entry.type === "review_report")).toBe(true);
  });

  it("blocks before runner execution when budget estimate exceeds remaining budget", async () => {
    const repo = cwd();
    const decision = schedule(repo, "attempt_budget", {
      step: fixtureStep({ recommendedModelCapability: "frontier" }),
      initiative: fixtureInitiative({ budgetProfile: "tiny" }),
      budgetProfile: "tiny",
      budgetRemainingUsdEstimate: 0.1,
      contextSize: "large",
    });
    let executed = false;
    const runner: StepAttemptRunner = {
      name: "local-shell",
      async execute() {
        executed = true;
        throw new Error("runner should not execute when budget is blocked");
      },
    };

    const result = await new StepAttemptOrchestrator().execute({
      cwd: repo,
      step: fixtureStep({ recommendedModelCapability: "frontier" }),
      schedulerDecision: decision,
      selectedModelId: "claude-opus-4-6",
      runner,
      worktreePath: path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_budget"),
      stepPrompt: "budget guard sample",
      now: new Date("2026-05-04T06:00:01.000Z"),
    });

    expect(executed).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.runnerStatus).toBe("blocked");
    expect(result.nextAction.reason).toBe("budget_estimate_exceeds_remaining");
    expect(
      loadSchedulerDecision({
        cwd: repo,
        runId: "run_demo",
        stepId: "step_001",
        attemptId: "attempt_budget",
      }),
    ).toMatchObject({
      status: "blocked",
      blockedReason: "budget_estimate_exceeds_remaining",
      routingReason: expect.arrayContaining(["budget_estimate_exceeds_remaining"]),
    });
    expect(readModelInvocations(repo, "run_demo")).toHaveLength(0);
    const schedulerBlocked = readAuditEvents(repo, "run_demo").find((event) => event.eventType === "scheduler_blocked");
    expect(schedulerBlocked?.payload).toMatchObject({
      stepId: "step_001",
      attemptId: "attempt_budget",
      reason: "budget_estimate_exceeds_remaining",
    });
  });

  it("turns runner exceptions with artifacts into structured attempt errors", async () => {
    const repo = cwd();
    const decision = schedule(repo, "attempt_003");
    const artifact: Artifact = {
      type: "command_output",
      ref: "steps/step_001/attempt_003/artifacts/runner-error.json",
      createdAt: "2026-05-04T06:00:01.000Z",
    };
    const runner: StepAttemptRunner = {
      name: "local-shell",
      async execute() {
        const error = new Error("runner crashed") as Error & {
          artifactRefs: Artifact[];
          code: string;
        };
        error.code = "RUNNER_CRASHED";
        error.artifactRefs = [artifact];
        throw error;
      },
    };

    const result = await new StepAttemptOrchestrator().execute({
      cwd: repo,
      step: fixtureStep(),
      schedulerDecision: decision,
      runner,
      worktreePath: path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_003"),
      stepPrompt: "exception sample",
      now: new Date("2026-05-04T06:00:01.000Z"),
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RUNNER_CRASHED");
    expect(result.artifactRefs.some((entry) => entry.ref === artifact.ref)).toBe(true);
    expect(result.nextAction.type).toBe("fix_step");
  });
});
