import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { InitiativeSchema, RunManifestSchema, TaskGraphSchema } from "@kiwi/contracts";
import { runInit } from "../commands/init";
import { runPlan } from "../commands/plan";

function readJson(target: string): unknown {
  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}

describe("kiwi plan", () => {
  it("stores schema-valid planned run artifacts under run directory", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-plan-"));
    await runInit({}, cwd);

    const ticketPath = path.join(cwd, "ticket.md");
    writeFileSync(
      ticketPath,
      `# Feature: Roles

## Analyze current behavior
## Plan implementation
## Add tests
## Implement changes
## Validate`,
      "utf-8",
    );

    await runPlan(
      ticketPath,
      {
        now: new Date("2026-05-03T19:00:00.000Z"),
        runIdSuffix: "abcd",
        initiativeIdSuffix: "abcd",
        planIdSuffix: "abcd",
      },
      cwd,
    );

    const runsRoot = path.join(cwd, ".kiwi", "runs");
    const runs = readdirSync(runsRoot);
    expect(runs.length).toBe(1);

    const runId = runs[0];
    expect(runId).toBeDefined();
    const runDir = path.join(runsRoot, runId!);
    const run = RunManifestSchema.parse(readJson(path.join(runDir, "run.json")));
    const initiative = InitiativeSchema.parse(readJson(path.join(runDir, "initiative.json")));
    const taskGraph = TaskGraphSchema.parse(readJson(path.join(runDir, "plan", "task-graph.json")));

    expect(run.runId).toBe("run_20260503_190000_abcd");
    expect(initiative.id).toBe("init_20260503_190000_abcd");
    expect(taskGraph.planId).toBe("plan_20260503_190000_abcd");
    expect(existsSync(path.join(runDir, "plan", "planner-input.json"))).toBe(true);
    expect(existsSync(path.join(runDir, "plan", "planner-output.json"))).toBe(true);

    const plannerOutput = readJson(path.join(runDir, "plan", "planner-output.json")) as {
      providerName: string;
      plannerModelId: string;
      modelInvocationRef: string;
      validation: { schema: string; valid: boolean };
      retry: { attemptsUsed: number; invalidAttempts: number };
      budget: { profile: string; remainingUsdEstimate: number | null };
    };
    expect(plannerOutput.providerName).toBe("stub-deterministic");
    expect(plannerOutput.plannerModelId).toBe("stub-frontier");
    expect(plannerOutput.modelInvocationRef).toContain("model-invocations.jsonl#planner");
    expect(plannerOutput.validation.schema).toBe("TaskGraphSchema");
    expect(plannerOutput.validation.valid).toBe(true);
    expect(plannerOutput.retry.attemptsUsed).toBe(1);
    expect(plannerOutput.retry.invalidAttempts).toBe(0);
    expect(plannerOutput.budget.profile).toBe("normal");
    expect(plannerOutput.budget.remainingUsdEstimate).toBe(10);
    expect(existsSync(path.join(runDir, "plan", "cost-report.json"))).toBe(true);
    const invocations = readFileSync(path.join(runDir, "model-invocations.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { phase: string; modelId: string; providerName: string });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      phase: "planner",
      modelId: "stub-frontier",
      providerName: "stub-deterministic",
    });
  });

  it("accepts inline ticket text when the argument is not a file path", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-plan-inline-"));
    await runInit({}, cwd);

    await runPlan("Implement inline ticket planning", {}, cwd);

    const runsRoot = path.join(cwd, ".kiwi", "runs");
    const runs = readdirSync(runsRoot);
    expect(runs).toHaveLength(1);
    const initiative = InitiativeSchema.parse(readJson(path.join(runsRoot, runs[0]!, "initiative.json")));

    expect(initiative.source).toBe("cli");
    expect(initiative.rawInput).toBe("Implement inline ticket planning");
  });

  it("stores workspace runs under the workspace root while targeting a selected repo", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-plan-workspace-"));
    const repo = path.join(workspace, "voice-core");
    mkdirSync(repo);
    writeFileSync(
      path.join(workspace, "workspace.code-workspace"),
      JSON.stringify({ folders: [{ name: "voice-core", path: "voice-core" }] }),
      "utf-8",
    );
    await runInit({}, workspace);

    await runPlan(
      "Implement workspace-aware planning",
      {
        workspace,
        repo: "voice-core",
        now: new Date("2026-05-03T20:00:00.000Z"),
        runIdSuffix: "w001",
        initiativeIdSuffix: "w001",
        planIdSuffix: "w001",
      },
      os.tmpdir(),
    );

    const runDir = path.join(workspace, ".kiwi", "runs", "run_20260503_200000_w001");
    const run = RunManifestSchema.parse(readJson(path.join(runDir, "run.json")));
    const initiative = InitiativeSchema.parse(readJson(path.join(runDir, "initiative.json")));

    expect(run.workspacePath).toBe(workspace);
    expect(run.repoId).toBe("voice-core");
    expect(run.repoPath).toBe(repo);
    expect(initiative.repoPath).toBe(repo);
    expect(existsSync(path.join(repo, ".kiwi"))).toBe(false);
  });
});
