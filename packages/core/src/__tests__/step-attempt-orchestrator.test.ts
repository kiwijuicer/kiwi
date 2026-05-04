import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  Artifact,
  GateResultSchema,
  Initiative,
  ReviewVerdictSchema,
  Step,
} from "@kiwi/contracts";
import { readAuditEvents } from "../cost-ledger";
import { ReviewEngine } from "../review-engine";
import { scheduleStepAttempt } from "../scheduler-policy";
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

function schedule(repo: string, attemptId: string) {
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
    ) as { status: string; artifacts: Artifact[] };
    expect(attempt.status).toBe("completed");
    expect(attempt.artifacts).toHaveLength(4);
    expect(
      existsSync(
        path.join(repo, ".kiwi", "runs", "run_demo", "steps", "step_001", "attempt_001", "gate-results.json"),
      ),
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
      issueCodes: ["GATE_REVIEW_CONFLICT"],
    });
    expect(result.error?.code).toBe("RUNNER_FAILED");
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
