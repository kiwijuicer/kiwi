import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Artifact, Initiative, TaskGraph } from "@kiwi/contracts";
import { getRunStatusSummary, resolveActiveRun } from "../../runs/status";
import { recordRunFeedback } from "../../runs/feedback";
import { savePlannedRun } from "../../runs/store";
import { refreshRunStatusFromAttempts, updateRunPlanStatus, updateRunStatus } from "../../runs/lifecycle/status";
import { readAuditEvents } from "../../ledger/cost-ledger";

function fixtureInitiative(id: string, title: string): Initiative {
  return {
    id,
    title,
    rawInput: `# ${title}`,
    source: "file",
    repoPath: "/tmp/repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-04T04:00:00.000Z",
  };
}

function fixtureTaskGraph(runId: string, initiativeId: string, planId: string): TaskGraph {
  return {
    planId,
    runId,
    initiativeId,
    summary: "Demo graph",
    acceptanceCriteria: ["works"],
    assumptions: [],
    openQuestions: [],
    riskScore: 2,
    complexityScore: 2,
    createdAt: "2026-05-04T04:00:00.000Z",
    steps: [
      {
        stepId: "step_001",
        type: "planning",
        title: "Plan",
        dependsOn: [],
        successCriteria: ["clear steps"],
        requiredGates: [],
        recommendedAgentRole: "planner",
        recommendedModelCapability: "frontier",
        status: "pending",
      },
    ],
  };
}

function fixtureDetailedTaskGraph(runId: string, initiativeId: string, planId: string): TaskGraph {
  return {
    ...fixtureTaskGraph(runId, initiativeId, planId),
    steps: [
      {
        stepId: "step_001",
        type: "code_modification",
        title: "Implement output",
        dependsOn: [],
        successCriteria: ["details shown"],
        requiredGates: [],
        recommendedAgentRole: "executor",
        recommendedModelCapability: "strong",
        status: "pending",
      },
      {
        stepId: "step_002",
        type: "test_creation",
        title: "Cover output",
        dependsOn: ["step_001"],
        successCriteria: ["tests pass"],
        requiredGates: ["tests"],
        recommendedAgentRole: "executor",
        recommendedModelCapability: "mid",
        status: "pending",
      },
      {
        stepId: "step_003",
        type: "validation",
        title: "Validate output",
        dependsOn: ["step_002"],
        successCriteria: ["checks pass"],
        requiredGates: ["typecheck"],
        recommendedAgentRole: "reviewer",
        recommendedModelCapability: "strong",
        status: "pending",
      },
    ],
  };
}

function writeAttempt(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  diff?: string;
  scheduler?: boolean;
}): void {
  const attemptDir = path.join(params.cwd, ".kiwi", "runs", params.runId, "steps", params.stepId, params.attemptId);
  const artifactsDir = path.join(attemptDir, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  const artifacts: Artifact[] = [];

  if (params.diff) {
    const diffRef = `steps/${params.stepId}/${params.attemptId}/artifacts/diff.patch`;
    writeFileSync(path.join(params.cwd, ".kiwi", "runs", params.runId, diffRef), params.diff, "utf-8");
    artifacts.push({ type: "diff", ref: diffRef, createdAt: params.completedAt ?? params.startedAt });
  }
  writeFileSync(
    path.join(attemptDir, "attempt.json"),
    JSON.stringify({
      attemptId: params.attemptId,
      stepId: params.stepId,
      runner: "local-shell",
      agentRole: "executor",
      modelCapability: "mid",
      status: params.status,
      contextPackageRef: `steps/${params.stepId}/${params.attemptId}/context-package.json`,
      modelInvocationRefs: [],
      artifacts,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
    }),
    "utf-8",
  );
  if (params.scheduler) {
    writeFileSync(
      path.join(attemptDir, "scheduler-decision.json"),
      JSON.stringify({
        status: "scheduled",
        runId: params.runId,
        stepId: params.stepId,
        attemptId: params.attemptId,
        agentRole: "executor",
        modelCapability: "mid",
        runner: "local-shell",
        contextLevel: "L0",
        reviewDepth: "strong",
        requiredGates: [],
        routingReason: ["runner_selected:local-shell"],
        contextPackageRef: `steps/${params.stepId}/${params.attemptId}/context-package.json`,
      }),
      "utf-8",
    );
  }
}

function writeFinalVerdict(params: { cwd: string; runId: string; safeToApply: boolean }): void {
  const finalDir = path.join(params.cwd, ".kiwi", "runs", params.runId, "final");
  mkdirSync(finalDir, { recursive: true });
  writeFileSync(
    path.join(finalDir, "final-verdict.json"),
    JSON.stringify({
      schemaVersion: "1",
      runId: params.runId,
      verdict: params.safeToApply ? "pass" : "needs_changes",
      safeToApply: params.safeToApply,
      completedStepIds: [],
      failedStepIds: params.safeToApply ? [] : ["step_001"],
      blockedStepIds: [],
      missingStepIds: [],
      gateResultRefs: [],
      reviewReportRefs: [],
      reason: params.safeToApply ? "All planned steps completed" : "Run needs changes",
      createdAt: "2026-05-04T04:04:00.000Z",
    }),
    "utf-8",
  );
}

describe("run status summary", () => {
  it("refreshes run status from the latest attempt for each step", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-status-retry-"));
    const runId = "run_20260504_040000_retry";

    savePlannedRun({
      runId,
      initiative: fixtureInitiative("init_20260504_040000_retry", "Feature Retry"),
      taskGraph: fixtureTaskGraph(runId, "init_20260504_040000_retry", "plan_20260504_040000_retry"),
      cwd,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });

    const attemptsDir = path.join(cwd, ".kiwi", "runs", runId, "steps", "step_001");

    for (const [attemptId, status, startedAt] of [
      ["attempt_failed", "failed", "2026-05-04T04:01:00.000Z"],
      ["attempt_completed", "completed", "2026-05-04T04:02:00.000Z"],
    ] as const) {
      const attemptDir = path.join(attemptsDir, attemptId);
      mkdirSync(attemptDir, { recursive: true });
      writeFileSync(
        path.join(attemptDir, "attempt.json"),
        JSON.stringify({
          attemptId,
          stepId: "step_001",
          runner: "local-shell",
          agentRole: "executor",
          modelCapability: "mid",
          status,
          contextPackageRef: `steps/step_001/${attemptId}/context-package.json`,
          modelInvocationRefs: [],
          artifacts: [],
          startedAt,
          completedAt: startedAt,
        }),
        "utf-8",
      );
    }

    const run = refreshRunStatusFromAttempts({
      cwd,
      runId,
      now: new Date("2026-05-04T04:03:00.000Z"),
    });

    expect(run.status).toBe("completed");
  });

  it("returns detailed latest run entries", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-status-"));

    savePlannedRun({
      runId: "run_20260504_040000_a001",
      initiative: fixtureInitiative("init_20260504_040000_a001", "Feature A"),
      taskGraph: fixtureTaskGraph("run_20260504_040000_a001", "init_20260504_040000_a001", "plan_20260504_040000_a001"),
      cwd,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });

    const summary = getRunStatusSummary(cwd);
    expect(summary.total).toBe(1);
    expect(summary.latest[0]?.initiativeTitle).toBe("Feature A");
    expect(summary.latest[0]?.stepCount).toBe(1);
    expect(summary.latest[0]?.artifactPaths.taskGraph).toBe(".kiwi/runs/run_20260504_040000_a001/plan/task-graph.json");
  });

  it("ignores non-run folders when listing status", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-status-invalid-"));

    savePlannedRun({
      runId: "run_20260504_040000_valid",
      initiative: fixtureInitiative("init_20260504_040000_valid", "Feature Valid"),
      taskGraph: fixtureTaskGraph(
        "run_20260504_040000_valid",
        "init_20260504_040000_valid",
        "plan_20260504_040000_valid",
      ),
      cwd,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });
    mkdirSync(path.join(cwd, ".kiwi", "runs", "legacy-run"), { recursive: true });

    const summary = getRunStatusSummary(cwd);

    expect(summary.total).toBe(1);
    expect(summary.corrupt).toEqual([]);
    expect(summary.latest[0]?.runId).toBe("run_20260504_040000_valid");
  });

  it("derives step state, active activity, and edited files from run evidence", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-status-detail-"));
    const runId = "run_20260504_040000_detail";

    savePlannedRun({
      runId,
      initiative: fixtureInitiative("init_20260504_040000_detail", "Feature Detail"),
      taskGraph: fixtureDetailedTaskGraph(runId, "init_20260504_040000_detail", "plan_20260504_040000_detail"),
      cwd,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });

    writeAttempt({
      cwd,
      runId,
      stepId: "step_001",
      attemptId: "attempt_done",
      status: "completed",
      startedAt: "2026-05-04T04:01:00.000Z",
      completedAt: "2026-05-04T04:02:00.000Z",
      diff: [
        "diff --git a/apps/cli/src/commands/runs/status.ts b/apps/cli/src/commands/runs/status.ts",
        "--- a/apps/cli/src/commands/runs/status.ts",
        "+++ b/apps/cli/src/commands/runs/status.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
      ].join("\n"),
    });
    writeAttempt({
      cwd,
      runId,
      stepId: "step_002",
      attemptId: "attempt_running",
      status: "running",
      startedAt: "2026-05-04T04:03:00.000Z",
      completedAt: null,
      scheduler: true,
    });

    const entry = getRunStatusSummary(cwd, runId).latest[0];

    expect(entry?.status).toBe("planned");
    expect(entry?.currentStatus).toBe("running");
    expect(entry?.steps.map((step) => [step.stepId, step.status])).toEqual([
      ["step_001", "completed"],
      ["step_002", "running"],
      ["step_003", "pending"],
    ]);
    expect(entry?.completedSteps.map((step) => step.stepId)).toEqual(["step_001"]);
    expect(entry?.remainingSteps.map((step) => step.stepId)).toEqual(["step_002", "step_003"]);
    expect(entry?.editedFiles).toEqual([
      {
        path: "apps/cli/src/commands/runs/status.ts",
        stepId: "step_001",
        attemptId: "attempt_done",
        diffRef: "steps/step_001/attempt_done/artifacts/diff.patch",
      },
    ]);
    expect(entry?.activeStepActivity).toEqual([
      {
        stepId: "step_002",
        title: "Cover output",
        attemptId: "attempt_running",
        status: "running",
        runner: "local-shell",
        startedAt: "2026-05-04T04:03:00.000Z",
        contextPackageRef: "steps/step_002/attempt_running/context-package.json",
        schedulerStatus: "scheduled",
        routingReason: ["runner_selected:local-shell"],
        selectedAccessMode: null,
        selectedModelId: null,
        selectedProviderModel: null,
      },
    ]);
  });

  it("treats a final verdict as authoritative over stale running attempts", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-status-final-"));
    const runId = "run_20260504_040000_final";

    savePlannedRun({
      runId,
      initiative: fixtureInitiative("init_20260504_040000_final", "Feature Final"),
      taskGraph: fixtureTaskGraph(runId, "init_20260504_040000_final", "plan_20260504_040000_final"),
      cwd,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });
    updateRunStatus({
      cwd,
      runId,
      status: "running",
      now: new Date("2026-05-04T04:01:00.000Z"),
    });
    writeAttempt({
      cwd,
      runId,
      stepId: "step_001",
      attemptId: "attempt_running",
      status: "running",
      startedAt: "2026-05-04T04:02:00.000Z",
      completedAt: null,
    });
    writeFinalVerdict({ cwd, runId, safeToApply: false });

    const summary = getRunStatusSummary(cwd, runId);
    const entry = summary.latest[0];

    expect(summary.running).toBe(0);
    expect(summary.failed).toBe(1);
    expect(entry?.status).toBe("running");
    expect(entry?.currentStatus).toBe("failed");
    expect(entry?.artifactPaths.finalVerdict).toBe(`.kiwi/runs/${runId}/final/final-verdict.json`);
  });

  it("supports selected run status", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-status-select-"));

    savePlannedRun({
      runId: "run_20260504_040000_a001",
      initiative: fixtureInitiative("init_20260504_040000_a001", "Feature A"),
      taskGraph: fixtureTaskGraph("run_20260504_040000_a001", "init_20260504_040000_a001", "plan_20260504_040000_a001"),
      cwd,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });
    savePlannedRun({
      runId: "run_20260504_040000_b002",
      initiative: fixtureInitiative("init_20260504_040000_b002", "Feature B"),
      taskGraph: fixtureTaskGraph("run_20260504_040000_b002", "init_20260504_040000_b002", "plan_20260504_040000_b002"),
      cwd,
      now: new Date("2026-05-04T04:00:01.000Z"),
    });

    const summary = getRunStatusSummary(cwd, "run_20260504_040000_a001");
    expect(summary.total).toBe(1);
    expect(summary.latest[0]?.runId).toBe("run_20260504_040000_a001");
  });

  it("skips corrupt or partial run folders in aggregate status", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-status-corrupt-"));
    savePlannedRun({
      runId: "run_20260504_040000_valid",
      initiative: fixtureInitiative("init_20260504_040000_valid", "Feature Valid"),
      taskGraph: fixtureTaskGraph(
        "run_20260504_040000_valid",
        "init_20260504_040000_valid",
        "plan_20260504_040000_valid",
      ),
      cwd,
      now: new Date("2026-05-04T04:01:00.000Z"),
    });
    mkdirSync(path.join(cwd, ".kiwi", "runs", "run_20260504_040000_broken", "plan"), {
      recursive: true,
    });
    writeFileSync(
      path.join(cwd, ".kiwi", "runs", "run_20260504_040000_broken", "run.json"),
      JSON.stringify({
        runId: "run_20260504_040000_broken",
        initiativeId: "init_20260504_040000_broken",
        currentPlanId: "plan_20260504_040000_broken",
        status: "planned",
        createdAt: "2026-05-04T04:00:00.000Z",
        updatedAt: "2026-05-04T04:00:00.000Z",
      }),
      "utf-8",
    );

    const summary = getRunStatusSummary(cwd);
    expect(summary.total).toBe(2);
    expect(summary.latest.map((entry) => entry.runId)).toEqual(["run_20260504_040000_valid"]);
    expect(summary.corrupt).toEqual([
      {
        runId: "run_20260504_040000_broken",
        error:
          "Run run_20260504_040000_broken is corrupt: missing required artifact .kiwi/runs/run_20260504_040000_broken/initiative.json",
      },
    ]);

    expect(() => getRunStatusSummary(cwd, "run_20260504_040000_broken")).toThrow("is corrupt");

    rmSync(path.join(cwd, ".kiwi"), { recursive: true, force: true });
  });

  it("resolves the newest non-final active run for a repo", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-active-run-"));
    const repoA = path.join(cwd, "repo-a");
    const repoB = path.join(cwd, "repo-b");

    savePlannedRun({
      runId: "run_20260504_040000_done",
      initiative: fixtureInitiative("init_20260504_040000_done", "Done"),
      taskGraph: fixtureTaskGraph("run_20260504_040000_done", "init_20260504_040000_done", "plan_done"),
      cwd,
      repoId: "repo-a",
      repoPath: repoA,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });
    updateRunStatus({
      cwd,
      runId: "run_20260504_040000_done",
      status: "completed",
      now: new Date("2026-05-04T04:01:00.000Z"),
    });
    savePlannedRun({
      runId: "run_20260504_040000_failed",
      initiative: fixtureInitiative("init_20260504_040000_failed", "Failed"),
      taskGraph: fixtureTaskGraph("run_20260504_040000_failed", "init_20260504_040000_failed", "plan_failed"),
      cwd,
      repoId: "repo-a",
      repoPath: repoA,
      now: new Date("2026-05-04T04:02:00.000Z"),
    });
    updateRunStatus({
      cwd,
      runId: "run_20260504_040000_failed",
      status: "failed",
      now: new Date("2026-05-04T04:03:00.000Z"),
    });
    savePlannedRun({
      runId: "run_20260504_040000_other",
      initiative: fixtureInitiative("init_20260504_040000_other", "Other"),
      taskGraph: fixtureTaskGraph("run_20260504_040000_other", "init_20260504_040000_other", "plan_other"),
      cwd,
      repoId: "repo-b",
      repoPath: repoB,
      now: new Date("2026-05-04T04:04:00.000Z"),
    });

    expect(resolveActiveRun({ cwd, repoPath: repoA })?.runId).toBe("run_20260504_040000_failed");
    expect(resolveActiveRun({ cwd, repoPath: repoB })?.runId).toBe("run_20260504_040000_other");

    updateRunStatus({
      cwd,
      runId: "run_20260504_040000_failed",
      status: "cancelled",
      now: new Date("2026-05-04T04:05:00.000Z"),
    });
    expect(resolveActiveRun({ cwd, repoPath: repoA })).toBeNull();
  });

  it("records feedback artifacts and audit events", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-feedback-"));
    const runId = "run_20260504_040000_feedback";

    savePlannedRun({
      runId,
      initiative: fixtureInitiative("init_20260504_040000_feedback", "Feedback"),
      taskGraph: fixtureTaskGraph(runId, "init_20260504_040000_feedback", "plan_feedback"),
      cwd,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });
    const result = recordRunFeedback({
      cwd,
      runId,
      message: "Make the change smaller",
      source: "mcp",
      author: "norbert",
      evidenceRefs: ["steps/step_001/attempt_001/artifacts/review-report.json"],
      now: new Date("2026-05-04T04:01:00.000Z"),
    });

    expect(result.ref).toMatch(/^feedback\/feedback_/);
    expect(existsSync(path.join(cwd, ".kiwi", "runs", runId, result.ref))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(cwd, ".kiwi", "runs", runId, result.ref), "utf-8"))).toMatchObject({
      message: "Make the change smaller",
      source: "mcp",
      author: "norbert",
    });
    expect(readAuditEvents(cwd, runId).find((event) => event.eventType === "feedback_recorded")).toBeDefined();
  });

  it("ignores stale failed attempts after a planner-backed replan", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-core-status-replan-"));
    const runId = "run_20260504_040000_replanned";
    const initiativeId = "init_20260504_040000_replanned";
    const original = fixtureTaskGraph(runId, initiativeId, "plan_original");

    savePlannedRun({
      runId,
      initiative: fixtureInitiative(initiativeId, "Replanned"),
      taskGraph: original,
      cwd,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });
    writeAttempt({
      cwd,
      runId,
      stepId: "step_001",
      attemptId: "attempt_failed",
      status: "failed",
      startedAt: "2026-05-04T04:01:00.000Z",
      completedAt: "2026-05-04T04:02:00.000Z",
    });
    expect(refreshRunStatusFromAttempts({ cwd, runId }).status).toBe("failed");
    writeFileSync(
      path.join(cwd, ".kiwi", "runs", runId, "plan", "task-graph.v2.json"),
      JSON.stringify({ ...original, planId: "plan_replanned", createdAt: "2026-05-04T04:03:00.000Z" }, null, 2),
      "utf-8",
    );
    updateRunPlanStatus({
      cwd,
      runId,
      planId: "plan_replanned",
      status: "planned",
      now: new Date("2026-05-04T04:03:00.000Z"),
    });

    const entry = getRunStatusSummary(cwd, runId).latest[0];
    expect(entry?.currentStatus).toBe("planned");
    expect(entry?.attempts).toEqual([]);
    expect(entry?.remainingSteps.map((step) => step.stepId)).toEqual(["step_001"]);
  });
});
