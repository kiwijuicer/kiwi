import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { Artifact, Initiative, TaskGraph } from "@kiwi/contracts";
import { savePlannedRun } from "@kiwi/core";
import { runInit } from "../../commands/setup/init";
import { runPlan } from "../../commands/planning/plan";
import { runStatus } from "../../commands/runs/status";

function testEnv(cwd: string, env: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ...env,
    KIWI_HOME: env.KIWI_HOME ?? path.join(path.dirname(cwd), `${path.basename(cwd)}-home`),
    KIWI_TEST_ALLOW_STUB: env.KIWI_TEST_ALLOW_STUB ?? "1",
    KIWI_FORCE_ACCESS_MODE: env.KIWI_FORCE_ACCESS_MODE ?? "stub",
  };
}

async function init(cwd: string): Promise<void> {
  await runInit({ env: testEnv(cwd) }, cwd);
}

function fixtureInitiative(id: string, title: string): Initiative {
  return {
    id,
    title,
    rawInput: title,
    source: "cli",
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
        type: "code_modification",
        title: "Implement details",
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
        title: "Cover details",
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
        title: "Validate details",
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

function writeStatusAttempt(params: {
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

describe("kiwi status", () => {
  it("prints explicit empty-state summary", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-status-"));
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runStatus(cwd);

    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("runs: 0");
    expect(output).toContain("no runs found");
    spy.mockRestore();
  });

  it("prints compact run summary by default", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-status-compact-"));
    await init(cwd);
    await runPlan(
      "# Feature: Compact Status\n\n## Analyze\n## Implement",
      {
        env: testEnv(cwd, { PATH: "/empty" }),
        now: new Date("2026-05-04T04:00:00.000Z"),
        runIdSuffix: "s000",
        initiativeIdSuffix: "s000",
        planIdSuffix: "s000",
      },
      cwd,
    );

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runStatus(cwd);
    const output = spy.mock.calls.flat().join("\n");

    expect(output).toContain("runId  status  cost  next-action");
    expect(output).toContain("run_20260504_060000_s000  planned  $0.00  continue_or_finalize");
    expect(output).not.toContain("artifacts:");
    spy.mockRestore();
  });

  it("prints detailed run summary with title, plan, step count, and artifact paths behind verbose", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-status-details-"));
    await init(cwd);
    await runPlan(
      "# Feature: Status Details\n\n## Analyze\n## Plan\n## Implement\n## Validate",
      {
        env: testEnv(cwd, { PATH: "/empty" }),
        now: new Date("2026-05-04T04:00:00.000Z"),
        runIdSuffix: "s001",
        initiativeIdSuffix: "s001",
        planIdSuffix: "s001",
      },
      cwd,
    );

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runStatus(cwd, undefined, { verbose: true });
    const output = spy.mock.calls.flat().join("\n");

    expect(output).toContain("runs: 1");
    expect(output).toContain("run_20260504_060000_s001");
    expect(output).toContain("title: Feature: Status Details");
    expect(output).toContain("plan: plan_20260504_060000_s001");
    expect(output).toContain("steps: 4");
    expect(output).toContain("subplans:");
    expect(output).toContain("subplan_1 [max=1]");
    expect(output).toContain("step_status:");
    expect(output).toContain("edited_files:");
    expect(output).toContain("none");
    expect(output).toContain("active_activity:");
    expect(output).toContain(".kiwi/runs/run_20260504_060000_s001/run.json");
    expect(output).toContain(".kiwi/runs/run_20260504_060000_s001/initiative.json");
    expect(output).toContain(".kiwi/runs/run_20260504_060000_s001/plan/task-graph.json");
    spy.mockRestore();
  });

  it("prints detailed step state, edited files, and active activity behind verbose", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-status-state-"));
    const runId = "run_20260504_060000_state";
    savePlannedRun({
      runId,
      initiative: fixtureInitiative("init_20260504_060000_state", "Feature State"),
      taskGraph: fixtureTaskGraph(runId, "init_20260504_060000_state", "plan_20260504_060000_state"),
      cwd,
      now: new Date("2026-05-04T04:00:00.000Z"),
    });
    writeStatusAttempt({
      cwd,
      runId,
      stepId: "step_001",
      attemptId: "attempt_done",
      status: "completed",
      startedAt: "2026-05-04T04:01:00.000Z",
      completedAt: "2026-05-04T04:02:00.000Z",
      diff: [
        "diff --git a/packages/core/src/status.ts b/packages/core/src/status.ts",
        "--- a/packages/core/src/status.ts",
        "+++ b/packages/core/src/status.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
      ].join("\n"),
    });
    writeStatusAttempt({
      cwd,
      runId,
      stepId: "step_002",
      attemptId: "attempt_running",
      status: "running",
      startedAt: "2026-05-04T04:03:00.000Z",
      completedAt: null,
      scheduler: true,
    });

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runStatus(cwd, runId, { verbose: true });
    const output = spy.mock.calls.flat().join("\n");
    spy.mockRestore();

    expect(output).toContain("run_state: running");
    expect(output).toContain("manifest_status: planned");
    expect(output).toContain("step_001  completed  Implement details attempt:attempt_done");
    expect(output).toContain("step_002  running  Cover details attempt:attempt_running");
    expect(output).toContain("step_003  pending  Validate details");
    expect(output).toContain("completed_steps: step_001");
    expect(output).toContain("remaining_steps: step_002:running, step_003:pending");
    expect(output).toContain("packages/core/src/status.ts  step_001/attempt_done");
    expect(output).toContain("step_002/attempt_running  running  runner:local-shell scheduler:scheduled");
    expect(output).toContain("context: steps/step_002/attempt_running/context-package.json");
  });

  it("supports selected run view", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-status-select-"));
    await init(cwd);
    await runPlan(
      "Ticket A",
      {
        env: testEnv(cwd, { PATH: "/empty" }),
        now: new Date("2026-05-04T04:00:00.000Z"),
        runIdSuffix: "a001",
        initiativeIdSuffix: "a001",
        planIdSuffix: "a001",
      },
      cwd,
    );
    await runPlan(
      "Ticket B",
      {
        env: testEnv(cwd, { PATH: "/empty" }),
        now: new Date("2026-05-04T04:00:01.000Z"),
        runIdSuffix: "b002",
        initiativeIdSuffix: "b002",
        planIdSuffix: "b002",
      },
      cwd,
    );

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runStatus(cwd, "run_20260504_060001_b002");
    const output = spy.mock.calls.flat().join("\n");

    expect(output).toContain("runId  status  cost  next-action");
    expect(output).toContain("run_20260504_060001_b002");
    expect(output).not.toContain("run_20260504_060000_a001");
    spy.mockRestore();
  });

  it("prints valid runs and reports corrupt folders without failing", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-status-corrupt-"));
    await init(cwd);
    await runPlan(
      "Ticket A",
      {
        env: testEnv(cwd, { PATH: "/empty" }),
        now: new Date("2026-05-04T04:00:00.000Z"),
        runIdSuffix: "a001",
        initiativeIdSuffix: "a001",
        planIdSuffix: "a001",
      },
      cwd,
    );
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

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runStatus(cwd);
    const output = spy.mock.calls.flat().join("\n");
    spy.mockRestore();

    expect(output).toContain("run_20260504_060000_a001");
    expect(output).toContain("corrupt runs skipped: 1");
    expect(output).toContain("run_20260504_040000_broken");
  });
});
