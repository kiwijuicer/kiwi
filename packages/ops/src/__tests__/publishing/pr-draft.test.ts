import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { GateResultSchema, ReviewVerdictSchema, StepAttemptSchema } from "@kiwi/contracts";
import { savePlannedRun } from "@kiwi/core";
import { publishPrDraft } from "../../publishing/pr-draft";
import { StubReviewEngine } from "@kiwi/runtime";

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-pr-draft-"));
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeJson(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(value, null, 2), "utf-8");
}

describe("PR draft publishing", () => {
  it("uses local git, writes a Bitbucket PR draft artifact, and does not require API credentials", async () => {
    const workspace = tmp();
    const repo = path.join(workspace, "repo");
    mkdirSync(repo);
    git(["init", "-b", "main"], repo);
    git(["config", "user.name", "Kiwi Test"], repo);
    git(["config", "user.email", "kiwi@example.invalid"], repo);
    writeFileSync(path.join(repo, "a.txt"), "initial\n", "utf-8");
    git(["add", "a.txt"], repo);
    git(["commit", "-m", "initial"], repo);

    const now = "2026-05-05T08:00:00.000Z";
    savePlannedRun({
      cwd: workspace,
      runId: "run_demo",
      repoId: "repo",
      repoPath: repo,
      workspacePath: workspace,
      initiative: {
        id: "init_demo",
        title: "Demo change",
        rawInput: "# Demo change",
        source: "cli",
        repoPath: repo,
        riskProfile: "dev",
        budgetProfile: "normal",
        createdAt: now,
      },
      taskGraph: {
        planId: "plan_demo",
        runId: "run_demo",
        initiativeId: "init_demo",
        summary: "Demo",
        steps: [
          {
            stepId: "step_001",
            type: "coding",
            title: "Implement",
            dependsOn: [],
            successCriteria: ["Done"],
            requiredGates: ["tests"],
            recommendedAgentRole: "executor",
            recommendedModelCapability: "strong",
            status: "pending",
          },
        ],
        acceptanceCriteria: ["Done"],
        assumptions: [],
        openQuestions: [],
        riskScore: 1,
        complexityScore: 1,
        createdAt: now,
      },
      now: new Date(now),
    });

    const attemptDir = path.join(workspace, ".kiwi", "runs", "run_demo", "steps", "step_001", "attempt_001");
    mkdirSync(path.join(attemptDir, "artifacts"), { recursive: true });
    const diff = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n initial\n+kiwi\n";
    const diffHash = `sha256:${createHash("sha256").update(diff).digest("hex")}`;
    writeFileSync(path.join(attemptDir, "artifacts", "diff.patch"), diff, "utf-8");
    writeJson(
      path.join(attemptDir, "attempt.json"),
      StepAttemptSchema.parse({
        attemptId: "attempt_001",
        stepId: "step_001",
        runner: "local-shell",
        agentRole: "executor",
        modelCapability: "strong",
        status: "completed",
        contextPackageRef: "steps/step_001/attempt_001/context-package.json",
        artifacts: [
          { type: "diff", ref: "steps/step_001/attempt_001/artifacts/diff.patch", createdAt: now },
          { type: "review_report", ref: "steps/step_001/attempt_001/artifacts/review-report.json", createdAt: now },
        ],
        startedAt: now,
        completedAt: now,
      }),
    );
    writeJson(path.join(attemptDir, "gate-results.json"), [
      GateResultSchema.parse({
        gateId: "gate_tests",
        gateType: "tests",
        status: "pass",
        evidenceRefs: ["steps/step_001/attempt_001/artifacts/test-report.json"],
        reason: "pass",
        subject: { type: "diff", hash: diffHash },
      }),
    ]);
    writeJson(
      path.join(attemptDir, "artifacts", "review-report.json"),
      ReviewVerdictSchema.parse({
        verdict: "pass",
        safeToContinue: true,
        issues: [],
        recommendedNextSteps: ["Continue"],
        confidence: 1,
        subject: { type: "diff", hash: diffHash },
      }),
    );

    const added: string[][] = [];
    const pushed: string[][] = [];
    const runner = (args: string[], cwd: string) => {
      if (args[0] === "add") {
        added.push(args);
      }
      if (args[0] === "push") {
        pushed.push(args);

        return { stdout: "", stderr: "" };
      }
      if (args[0] === "remote" && args[1] === "get-url") {
        return { stdout: "git@bitbucket.org:example/api.git\n", stderr: "" };
      }

      return { stdout: git(args, cwd), stderr: "" };
    };

    writeFileSync(path.join(repo, "secret.txt"), "do not publish\n", "utf-8");
    await expect(
      publishPrDraft({
        cwd: workspace,
        runId: "run_demo",
        git: runner,
        now: new Date("2026-05-05T08:00:30.000Z"),
      }),
    ).rejects.toThrow("target repo has local changes");
    unlinkSync(path.join(repo, "secret.txt"));

    const result = await publishPrDraft({
      cwd: workspace,
      runId: "run_demo",
      git: runner,
      reviewEngine: new StubReviewEngine(),
      now: new Date("2026-05-05T08:01:00.000Z"),
    });

    expect(added).toContainEqual(["add", "--", "a.txt"]);
    expect(pushed[0]).toEqual(["push", "-u", "origin", "kiwi/run_demo"]);
    expect(result.prDraft.createUrl).toBe(
      "https://bitbucket.org/example/api/pull-requests/new?source=kiwi%2Frun_demo&dest=main",
    );
    expect(result.prDraft.diffHash).toBe(diffHash);
    expect(existsSync(path.join(workspace, ".kiwi", "runs", "run_demo", "final", "pr-draft.json"))).toBe(true);
    expect(
      readFileSync(path.join(workspace, ".kiwi", "runs", "run_demo", "final", "pr-draft.json"), "utf-8"),
    ).not.toContain("ANTHROPIC_API_KEY");
  });
});
