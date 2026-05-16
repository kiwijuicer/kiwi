import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { appendAuditEvent } from "@kiwi/core";
import { applyRunDiff, buildRunDiff, formatRunDiff } from "../diff-workflow";

function writeJson(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(value, null, 2), "utf-8");
}

function setupRun(reviewVerdict = "pass"): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), "kiwi-diff-workflow-"));
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  writeFileSync(path.join(repo, "README.md"), "demo\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=Kiwi", "-c", "user.email=kiwi@example.com", "commit", "-m", "initial"], {
    cwd: repo,
    stdio: "ignore",
  });
  const runDir = path.join(repo, ".kiwi", "runs", "run_demo");
  const attemptDir = path.join(runDir, "steps", "step_001", "attempt_001");
  writeJson(path.join(runDir, "run.json"), {
    runId: "run_demo",
    initiativeId: "init_demo",
    currentPlanId: "plan_demo",
    status: "planned",
    createdAt: "2026-05-08T10:00:00.000Z",
    updatedAt: "2026-05-08T10:00:00.000Z",
  });
  writeJson(path.join(runDir, "initiative.json"), {
    id: "init_demo",
    title: "Demo",
    rawInput: "Demo",
    source: "cli",
    repoPath: repo,
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-08T10:00:00.000Z",
  });
  writeJson(path.join(runDir, "plan", "task-graph.json"), {
    planId: "plan_demo",
    runId: "run_demo",
    initiativeId: "init_demo",
    summary: "Demo",
    steps: [
      {
        stepId: "step_001",
        type: "coding",
        title: "Add file",
        dependsOn: [],
        successCriteria: ["File added"],
        requiredGates: [],
        recommendedAgentRole: "executor",
        recommendedModelCapability: "mid",
        status: "pending",
      },
    ],
    acceptanceCriteria: ["Done"],
    assumptions: [],
    openQuestions: [],
    riskScore: 1,
    complexityScore: 1,
    createdAt: "2026-05-08T10:00:00.000Z",
  });
  const diffRef = "steps/step_001/attempt_001/artifacts/diff.patch";
  mkdirSync(path.dirname(path.join(runDir, diffRef)), { recursive: true });
  writeFileSync(
    path.join(runDir, diffRef),
    "diff --git a/feature.txt b/feature.txt\nnew file mode 100644\nindex 0000000..3e75765\n--- /dev/null\n+++ b/feature.txt\n@@ -0,0 +1 @@\n+new\n",
    "utf-8",
  );
  writeJson(path.join(attemptDir, "attempt.json"), {
    attemptId: "attempt_001",
    stepId: "step_001",
    runner: "local-shell",
    agentRole: "executor",
    modelCapability: "mid",
    status: "completed",
    contextPackageRef: "steps/step_001/attempt_001/context-package.json",
    artifacts: [{ type: "diff", ref: diffRef, createdAt: "2026-05-08T10:00:01.000Z" }],
    startedAt: "2026-05-08T10:00:01.000Z",
    completedAt: "2026-05-08T10:00:02.000Z",
  });
  writeJson(path.join(attemptDir, "artifacts", "review-report.json"), {
    verdict: reviewVerdict,
    safeToContinue: reviewVerdict === "pass",
    issues: [],
    recommendedNextSteps: ["Continue"],
    confidence: 0.9,
  });

  return repo;
}

describe("diff workflow", () => {
  it("shows stat plus persisted patch", () => {
    const repo = setupRun();
    const result = buildRunDiff({ cwd: repo, runId: "run_demo" });
    const output = formatRunDiff(result);
    expect(result.items).toHaveLength(1);
    expect(output).toContain("feature.txt");
    expect(output).toContain("diff --git");
  });

  it("applies pending worktree patches once and rejects repeats", () => {
    const repo = setupRun();
    const applied = applyRunDiff({ cwd: repo, runId: "run_demo" });
    expect(applied.message).toContain("applied 1 patch");
    expect(readFileSync(path.join(repo, "feature.txt"), "utf-8")).toBe("new\n");
    expect(() => applyRunDiff({ cwd: repo, runId: "run_demo" })).toThrow("Patch already applied");
  });

  it("treats direct-mode patches as already applied", () => {
    const repo = setupRun();
    appendAuditEvent(repo, {
      eventType: "attempt_diff_applied",
      runId: "run_demo",
      timestamp: "2026-05-08T10:00:03.000Z",
      payload: { stepId: "step_001", attemptId: "attempt_001", mode: "direct" },
    });
    const result = applyRunDiff({ cwd: repo, runId: "run_demo" });
    expect(result.message).toBe("already applied during run");
    expect(existsSync(path.join(repo, "feature.txt"))).toBe(false);
  });

  it("blocks rejected patches unless forced", () => {
    const repo = setupRun("needs_changes");
    expect(() => applyRunDiff({ cwd: repo, runId: "run_demo" })).toThrow("Refusing to apply");
    expect(applyRunDiff({ cwd: repo, runId: "run_demo", forceUnsafe: true }).applied).toHaveLength(1);
  });
});
