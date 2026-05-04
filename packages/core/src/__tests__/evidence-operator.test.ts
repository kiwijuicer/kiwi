import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Initiative, TaskGraph } from "@kiwi/contracts";
import { appendAuditEvent } from "../cost-ledger";
import { writeEvidenceManifest } from "../evidence";
import { writeOperatorSnapshot } from "../operator-surface";
import { savePlannedRun } from "../run-store";

function cwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-evidence-operator-"));
}

const initiative: Initiative = {
  id: "init_demo",
  title: "Operator Demo",
  rawInput: "# Operator Demo",
  source: "cli",
  repoPath: "/tmp/repo",
  riskProfile: "dev",
  budgetProfile: "normal",
  createdAt: "2026-05-04T11:00:00.000Z",
};

const taskGraph: TaskGraph = {
  planId: "plan_demo",
  runId: "run_demo",
  initiativeId: "init_demo",
  summary: "Demo graph",
  steps: [
    {
      stepId: "step_001",
      type: "planning",
      title: "Plan",
      dependsOn: [],
      successCriteria: ["Done"],
      requiredGates: [],
      recommendedAgentRole: "planner",
      recommendedModelCapability: "frontier",
      status: "pending",
    },
  ],
  acceptanceCriteria: ["Done"],
  assumptions: [],
  openQuestions: [],
  riskScore: 2,
  complexityScore: 1,
  createdAt: "2026-05-04T11:00:00.000Z",
};

function createRun(repo: string): void {
  savePlannedRun({
    cwd: repo,
    runId: "run_demo",
    initiative,
    taskGraph,
    plannerInput: { runId: "run_demo" },
    plannerOutput: { providerName: "stub" },
    now: new Date("2026-05-04T11:00:00.000Z"),
  });
}

describe("evidence and operator surfaces", () => {
  it("writes a hashed evidence manifest with a run-scoped audit snapshot", () => {
    const repo = cwd();
    createRun(repo);
    appendAuditEvent(repo, {
      eventType: "planner_succeeded",
      runId: "run_demo",
      timestamp: "2026-05-04T11:01:00.000Z",
      payload: { ok: true },
    });
    mkdirSync(path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_001"), {
      recursive: true,
    });
    writeFileSync(
      path.join(repo, ".kiwi", "runs", "run_demo", "worktrees", "attempt_001", "scratch.txt"),
      "scratch",
      "utf-8",
    );

    const result = writeEvidenceManifest({
      cwd: repo,
      runId: "run_demo",
      now: new Date("2026-05-04T11:02:00.000Z"),
    });

    expect(result.manifest.files.some((file) => file.ref === "run.json")).toBe(true);
    expect(result.manifest.files.some((file) => file.ref === "final/audit-events.json")).toBe(true);
    expect(result.manifest.files.some((file) => file.ref.startsWith("worktrees/"))).toBe(false);
    expect(result.auditSnapshot.eventCount).toBe(1);
    expect(
      existsSync(path.join(repo, ".kiwi", "runs", "run_demo", "final", "evidence-manifest.json")),
    ).toBe(true);
  });

  it("writes a local operator HTML snapshot", () => {
    const repo = cwd();
    createRun(repo);

    const result = writeOperatorSnapshot({
      cwd: repo,
      runId: "run_demo",
      now: new Date("2026-05-04T11:03:00.000Z"),
    });
    const html = readFileSync(path.join(repo, ".kiwi", "runs", "run_demo", result.ref), "utf-8");

    expect(result.ref).toBe("operator/index.html");
    expect(html).toContain("Operator Demo");
    expect(html).toContain("step_001");
  });
});
