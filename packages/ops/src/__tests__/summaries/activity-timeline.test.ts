import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Artifact, GateResult, Initiative, ReviewVerdict, TaskGraph } from "@kiwi/contracts";
import { appendAuditEvent, appendModelInvocation, savePlannedRun, updateRunStatus } from "@kiwi/core";
import { renderActivityTreeLines, renderActivityTimelineMarkdown } from "../../summaries/activity-render.js";
import { buildRunActivityTimeline } from "../../summaries/activity-timeline.js";

const NOW = "2026-05-04T12:00:00.000Z";

function cwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-ops-activity-"));
}

function initiative(repo: string): Initiative {
  return {
    id: "init_demo",
    title: "Activity Demo",
    rawInput: "# Demo",
    source: "cli",
    repoPath: repo,
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: NOW,
  };
}

function step(stepId: string, title: string, dependsOn: string[] = []): TaskGraph["steps"][number] {
  return {
    stepId,
    type: "coding",
    title,
    dependsOn,
    successCriteria: ["done"],
    requiredGates: ["tests"],
    recommendedAgentRole: "executor",
    recommendedModelCapability: "strong",
    status: "pending",
  };
}

function taskGraph(runId: string, steps: TaskGraph["steps"]): TaskGraph {
  return {
    planId: "plan_demo",
    runId,
    initiativeId: "init_demo",
    summary: "Demo graph",
    steps,
    acceptanceCriteria: ["done"],
    assumptions: [],
    openQuestions: [],
    riskScore: 2,
    complexityScore: 2,
    createdAt: NOW,
  };
}

function createRun(repo: string, runId = "run_demo", steps = [step("step_001", "Do one")]): void {
  savePlannedRun({
    cwd: repo,
    runId,
    initiative: initiative(repo),
    taskGraph: taskGraph(runId, steps),
    plannerInput: { runId },
    plannerOutput: { ok: true },
    now: new Date(NOW),
  });
  appendAuditEvent(repo, {
    eventType: "planner_succeeded",
    runId,
    timestamp: "2026-05-04T12:00:01.000Z",
    payload: { ok: true },
  });
}

function writeAttempt(params: {
  repo: string;
  runId?: string;
  stepId: string;
  attemptId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  gateStatus?: GateResult["status"];
  reviewVerdict?: ReviewVerdict["verdict"];
  safeToContinue?: boolean;
  diff?: boolean;
}): void {
  const runId = params.runId ?? "run_demo";
  const attemptDir = path.join(params.repo, ".kiwi", "runs", runId, "steps", params.stepId, params.attemptId);
  const artifactsDir = path.join(attemptDir, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  const artifacts: Artifact[] = [];

  if (params.diff) {
    const diffRef = `steps/${params.stepId}/${params.attemptId}/artifacts/diff.patch`;
    writeFileSync(path.join(params.repo, ".kiwi", "runs", runId, diffRef), "diff --git a/a b/a\n", "utf-8");
    artifacts.push({ type: "diff", ref: diffRef, createdAt: params.completedAt ?? params.startedAt });
  }
  writeFileSync(
    path.join(attemptDir, "attempt.json"),
    JSON.stringify({
      attemptId: params.attemptId,
      stepId: params.stepId,
      runner: "codex",
      agentRole: "executor",
      modelCapability: "strong",
      status: params.status,
      contextPackageRef: `steps/${params.stepId}/${params.attemptId}/context-package.json`,
      modelInvocationRefs: [],
      artifacts,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
    }),
    "utf-8",
  );
  writeFileSync(
    path.join(attemptDir, "scheduler-decision.json"),
    JSON.stringify({
      status: "scheduled",
      runId,
      stepId: params.stepId,
      attemptId: params.attemptId,
      agentRole: "executor",
      modelCapability: "strong",
      runner: "codex",
      contextLevel: "L1",
      reviewDepth: "strong",
      requiredGates: ["tests"],
      routingReason: ["runner_selected:codex"],
      selectedModelId: "gpt-test",
      selectedAccessMode: "codex-cli",
      contextPackageRef: `steps/${params.stepId}/${params.attemptId}/context-package.json`,
    }),
    "utf-8",
  );
  const gateStatus = params.gateStatus;

  if (gateStatus) {
    writeFileSync(
      path.join(attemptDir, "gate-results.json"),
      JSON.stringify([
        {
          gateId: "tests",
          gateType: "tests",
          status: gateStatus,
          evidenceRefs: [],
          reason: gateStatus,
        },
      ]),
      "utf-8",
    );
  }
  if (params.reviewVerdict) {
    writeFileSync(
      path.join(artifactsDir, "review-report.json"),
      JSON.stringify({
        verdict: params.reviewVerdict,
        safeToContinue: params.safeToContinue ?? params.reviewVerdict === "pass",
        issues: [],
        recommendedNextSteps: [],
        confidence: 0.9,
      }),
      "utf-8",
    );
  }
  if (params.completedAt) {
    writeFileSync(
      path.join(artifactsDir, "attempt-summary.json"),
      JSON.stringify({
        schemaVersion: "1",
        runId,
        stepId: params.stepId,
        attemptId: params.attemptId,
        status: params.status,
        runnerStatus: params.status === "completed" ? "completed" : "failed",
        nextAction: {
          type: params.status === "completed" ? "continue" : "fix_step",
          reason: "test",
          recommendedNextSteps: [],
          issueCodes: [],
        },
        gateResultsRef: `steps/${params.stepId}/${params.attemptId}/gate-results.json`,
        reviewReportRef: `steps/${params.stepId}/${params.attemptId}/artifacts/review-report.json`,
        costReportRef: `steps/${params.stepId}/${params.attemptId}/artifacts/cost-report.json`,
        modelInvocationRefs: [],
        artifactRefs: artifacts.map((artifact) => artifact.ref),
        completedAt: params.completedAt,
      }),
      "utf-8",
    );
  }
  appendAuditEvent(params.repo, {
    eventType: "step_attempt_started",
    runId,
    timestamp: params.startedAt,
    payload: { stepId: params.stepId, attemptId: params.attemptId, runner: "codex" },
  });
  appendModelInvocation(params.repo, {
    schemaVersion: "1",
    runId,
    phase: "executor",
    stepId: params.stepId,
    attemptId: params.attemptId,
    agentRole: "executor",
    requestedCapability: "strong",
    selectedCapability: "strong",
    modelId: "gpt-test",
    providerName: "openai",
    runner: "codex",
    accessMode: "codex-cli",
    usage: { inputTokens: 1, outputTokens: 1 },
    usagePrecision: "estimated",
    estimatedCostUsd: 0,
    status: params.status === "completed" ? "completed" : "failed",
    evidenceRefs: [],
    startedAt: params.startedAt,
    completedAt: params.completedAt ?? params.startedAt,
  });
}

describe("activity timeline", () => {
  it("renders a planned-only run as pending steps", () => {
    const repo = cwd();
    createRun(repo);

    const timeline = buildRunActivityTimeline({ cwd: repo, runId: "run_demo", now: new Date(NOW) });
    const lines = renderActivityTreeLines(timeline);

    expect(timeline.activities.find((activity) => activity.activityId === "run:planning")?.status).toBe("completed");
    expect(timeline.activities.find((activity) => activity.activityId === "step:step_001")?.status).toBe("pending");
    expect(lines).toContain("○ step_001 Do one (strong)");
    expect(renderActivityTreeLines(timeline, { ascii: true })).toContain("[todo] step_001 Do one (strong)");
  });

  it("derives running, completed, failed, blocked, retry, and replan activities", () => {
    const repo = cwd();
    createRun(repo, "run_demo", [
      step("step_001", "Retry then pass"),
      step("step_002", "Still running", ["step_001"]),
      step("step_003", "Fail review", ["step_002"]),
      step("step_004", "Blocked route", ["step_003"]),
    ]);
    writeAttempt({
      repo,
      stepId: "step_001",
      attemptId: "attempt_001",
      status: "failed",
      startedAt: "2026-05-04T12:01:00.000Z",
      completedAt: "2026-05-04T12:02:00.000Z",
      gateStatus: "fail",
      reviewVerdict: "reject",
      safeToContinue: false,
    });
    writeAttempt({
      repo,
      stepId: "step_001",
      attemptId: "attempt_002",
      status: "completed",
      startedAt: "2026-05-04T12:03:00.000Z",
      completedAt: "2026-05-04T12:04:00.000Z",
      gateStatus: "pass",
      reviewVerdict: "pass",
      diff: true,
    });
    writeAttempt({
      repo,
      stepId: "step_002",
      attemptId: "attempt_003",
      status: "running",
      startedAt: "2026-05-04T12:05:00.000Z",
      completedAt: null,
    });
    writeAttempt({
      repo,
      stepId: "step_003",
      attemptId: "attempt_004",
      status: "failed",
      startedAt: "2026-05-04T12:06:00.000Z",
      completedAt: "2026-05-04T12:07:00.000Z",
      gateStatus: "pass",
      reviewVerdict: "needs_changes",
      safeToContinue: false,
    });
    appendAuditEvent(repo, {
      eventType: "scheduler_blocked",
      runId: "run_demo",
      timestamp: "2026-05-04T12:08:00.000Z",
      payload: { stepId: "step_004", reason: "no_runner_available", routingReason: ["no_runner_available"] },
    });
    appendAuditEvent(repo, {
      eventType: "replan_succeeded",
      runId: "run_demo",
      timestamp: "2026-05-04T12:09:00.000Z",
      payload: { stepId: "step_003", reason: "review_failed" },
    });

    const timeline = buildRunActivityTimeline({ cwd: repo, runId: "run_demo", now: new Date(NOW) });
    const byId = new Map(timeline.activities.map((activity) => [activity.activityId, activity]));

    expect(byId.get("step:step_001")?.status).toBe("completed");
    expect(byId.get("step:step_001:attempt_001:execution")?.status).toBe("failed");
    expect(byId.get("step:step_001:attempt_002:diff")?.status).toBe("completed");
    expect(byId.get("step:step_002")?.status).toBe("running");
    expect(byId.get("step:step_003:attempt_004:review")?.status).toBe("failed");
    expect(byId.get("step:step_004")?.status).toBe("blocked");
    expect(timeline.activities.some((activity) => activity.title === "Replan succeeded")).toBe(true);
  });

  it("marks finalized runs and renders Markdown", () => {
    const repo = cwd();
    createRun(repo);
    updateRunStatus({ cwd: repo, runId: "run_demo", status: "completed", now: new Date("2026-05-04T12:10:00.000Z") });
    appendAuditEvent(repo, {
      eventType: "run_finalized",
      runId: "run_demo",
      timestamp: "2026-05-04T12:11:00.000Z",
      payload: { verdict: "pass" },
    });

    const markdown = renderActivityTimelineMarkdown(
      buildRunActivityTimeline({ cwd: repo, runId: "run_demo", now: new Date(NOW) }),
    );

    expect(markdown).toContain("## Activity Timeline run_demo");
    expect(markdown).toContain("✓ Finalize run");
  });
});
