import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Initiative, TaskGraph } from "@kiwi/contracts";
import {
  isInitialized,
  listRunManifests,
  loadInitiative,
  loadRunManifest,
  loadTaskGraph,
  resolveRunArtifactPath,
  savePlannedRun,
} from "../run-store";

function fixtureInitiative(): Initiative {
  return {
    id: "init_demo",
    title: "Demo",
    rawInput: "# Demo",
    source: "file",
    repoPath: "/tmp/repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-03T19:00:00.000Z",
  };
}

function fixtureTaskGraph(): TaskGraph {
  return {
    planId: "plan_demo",
    runId: "run_demo",
    initiativeId: "init_demo",
    summary: "Demo graph",
    acceptanceCriteria: ["works"],
    assumptions: [],
    openQuestions: [],
    riskScore: 2,
    complexityScore: 2,
    createdAt: "2026-05-03T19:00:00.000Z",
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

describe("run store", () => {
  it("persists planned runs under .kiwi/runs/<run-id>/ with reserved layout", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-run-store-"));
    mkdirSync(path.join(cwd, ".kiwi"), { recursive: true });
    writeFileSync(path.join(cwd, ".kiwi", "config.yaml"), 'version: "1"\n');

    expect(isInitialized(cwd)).toBe(true);

    const manifest = savePlannedRun({
      runId: "run_demo",
      initiative: fixtureInitiative(),
      taskGraph: fixtureTaskGraph(),
      cwd,
    });

    expect(manifest.runId).toBe("run_demo");

    const listed = listRunManifests(cwd);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.currentPlanId).toBe("plan_demo");

    const loadedPlan = loadTaskGraph("run_demo", cwd);
    expect(loadedPlan.steps[0]?.title).toBe("Plan");
    expect(existsSync(path.join(cwd, ".kiwi", "runs", "run_demo", "steps"))).toBe(true);
    expect(existsSync(path.join(cwd, ".kiwi", "runs", "run_demo", "final"))).toBe(true);
  });

  it("ignores invalid run directories when listing manifests", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-run-store-invalid-"));

    savePlannedRun({
      runId: "run_demo",
      initiative: fixtureInitiative(),
      taskGraph: fixtureTaskGraph(),
      cwd,
    });
    mkdirSync(path.join(cwd, ".kiwi", "runs", "legacy-run"), { recursive: true });
    writeFileSync(path.join(cwd, ".kiwi", "runs", "legacy-run", "run.json"), "not json", "utf-8");

    const listed = listRunManifests(cwd);

    expect(listed).toHaveLength(1);
    expect(listed[0]?.runId).toBe("run_demo");
  });

  it("writes deterministic manifest timestamp when now is injected", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-run-store-time-"));
    const now = new Date("2026-05-03T19:00:00.000Z");

    savePlannedRun({
      runId: "run_demo",
      initiative: fixtureInitiative(),
      taskGraph: fixtureTaskGraph(),
      cwd,
      now,
    });

    const run = loadRunManifest("run_demo", cwd);
    expect(run.createdAt).toBe(now.toISOString());
    expect(run.updatedAt).toBe(now.toISOString());
  });

  it("persists planner input and output artifacts when provided", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-run-store-planner-artifacts-"));

    savePlannedRun({
      runId: "run_demo",
      initiative: fixtureInitiative(),
      taskGraph: fixtureTaskGraph(),
      plannerInput: { runId: "run_demo", requestedAt: "2026-05-04T00:00:00.000Z" },
      plannerOutput: { providerName: "stub-deterministic", validation: { valid: true } },
      cwd,
      now: new Date("2026-05-04T00:00:00.000Z"),
    });

    expect(existsSync(path.join(cwd, ".kiwi", "runs", "run_demo", "plan", "planner-input.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".kiwi", "runs", "run_demo", "plan", "planner-output.json"))).toBe(true);
  });

  it("loads initiative and rejects invalid artifacts on read", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-run-store-validate-"));
    savePlannedRun({
      runId: "run_demo",
      initiative: fixtureInitiative(),
      taskGraph: fixtureTaskGraph(),
      cwd,
    });

    const loadedInitiative = loadInitiative("run_demo", cwd);
    expect(loadedInitiative.id).toBe("init_demo");

    const runManifestPath = path.join(cwd, ".kiwi", "runs", "run_demo", "run.json");
    const original = JSON.parse(readFileSync(runManifestPath, "utf-8")) as Record<string, unknown>;
    original.status = "definitely-invalid";
    writeFileSync(runManifestPath, JSON.stringify(original), "utf-8");

    expect(() => loadRunManifest("run_demo", cwd)).toThrow();
  });

  it("prevents path traversal in run artifact paths", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-run-store-paths-"));

    expect(() => resolveRunArtifactPath("..", "config.yaml", cwd)).toThrow("runId must look like run_<value>");
    expect(() => resolveRunArtifactPath("run_demo", "../outside.json", cwd)).toThrow(
      "artifact path escapes run directory",
    );
    expect(() => resolveRunArtifactPath("run_demo", "/etc/passwd", cwd)).toThrow(
      "artifact path must be relative to run directory",
    );
  });
});
