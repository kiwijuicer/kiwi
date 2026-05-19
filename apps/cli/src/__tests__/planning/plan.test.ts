import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { InitiativeSchema, RunManifestSchema, TaskGraphSchema } from "@kiwi/contracts";
import { runInit } from "../../commands/setup/init";
import { runPlan } from "../../commands/planning/plan";

function readJson(target: string): unknown {
  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}

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

describe("kiwi plan", () => {
  it("stores schema-valid planned run artifacts under run directory", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-plan-"));
    await init(cwd);

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
        env: testEnv(cwd, { PATH: "/empty" }),
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

    expect(run.runId).toBe("run_20260503_210000_abcd");
    expect(initiative.id).toBe("init_20260503_210000_abcd");
    expect(taskGraph.planId).toBe("plan_20260503_210000_abcd");
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
    await init(cwd);

    await runPlan("Implement inline ticket planning", { env: testEnv(cwd, { PATH: "/empty" }) }, cwd);

    const runsRoot = path.join(cwd, ".kiwi", "runs");
    const runs = readdirSync(runsRoot);
    expect(runs).toHaveLength(1);
    const initiative = InitiativeSchema.parse(readJson(path.join(runsRoot, runs[0]!, "initiative.json")));

    expect(initiative.source).toBe("cli");
    expect(initiative.rawInput).toBe("Implement inline ticket planning");
  });

  it("stores workspace runs under the workspace root while targeting a selected repo", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-plan-workspace-"));
    const repo = path.join(workspace, "api-service");
    mkdirSync(repo);
    writeFileSync(
      path.join(workspace, "workspace.code-workspace"),
      JSON.stringify({ folders: [{ name: "api-service", path: "api-service" }] }),
      "utf-8",
    );
    await init(workspace);

    await runPlan(
      "Implement workspace-aware planning",
      {
        env: testEnv(workspace, { PATH: "/empty" }),
        workspace,
        repo: "api-service",
        now: new Date("2026-05-03T20:00:00.000Z"),
        runIdSuffix: "w001",
        initiativeIdSuffix: "w001",
        planIdSuffix: "w001",
      },
      os.tmpdir(),
    );

    const runDir = path.join(workspace, ".kiwi", "runs", "run_20260503_220000_w001");
    const run = RunManifestSchema.parse(readJson(path.join(runDir, "run.json")));
    const initiative = InitiativeSchema.parse(readJson(path.join(runDir, "initiative.json")));

    expect(run.workspacePath).toBe(workspace);
    expect(run.repoId).toBe("api-service");
    expect(run.repoPath).toBe(repo);
    expect(initiative.repoPath).toBe(repo);
    expect(existsSync(path.join(repo, ".kiwi"))).toBe(false);
  });

  it("does not silently use the stub planner by default", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-plan-no-stub-"));
    await init(cwd);

    await expect(
      runPlan(
        "Implement real planning",
        { env: { KIWI_HOME: path.join(path.dirname(cwd), `${path.basename(cwd)}-home`), PATH: "/empty" } },
        cwd,
      ),
    ).rejects.toThrow(/No real planner model[\s\S]*stub-frontier \(stub\): disabled by default/);
  });

  it("writes safe progress to the configured progress writer", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-plan-progress-"));
    await init(cwd);
    const lines: string[] = [];

    await runPlan(
      "Implement visible planning progress",
      {
        env: testEnv(cwd, { PATH: "/empty" }),
        now: new Date("2026-05-04T12:00:00.000Z"),
        runIdSuffix: "prog",
        initiativeIdSuffix: "prog",
        planIdSuffix: "prog",
        progress: {
          enabled: true,
          write: (line) => lines.push(line),
        },
      },
      cwd,
    );

    expect(lines.join("\n")).toContain("Planning run...");
    expect(lines.join("\n")).toContain("planner: stub-frontier (stub-deterministic)");
    expect(lines.join("\n")).toContain("runId: run_20260504_140000_prog");
    expect(lines.join("\n")).toContain("generating TaskGraph");
    expect(lines.join("\n")).toContain(
      "phase=planner status=started runId=run_20260504_140000_prog model=stub-frontier provider=stub-deterministic",
    );
    expect(lines.join("\n")).toContain("phase=planner status=completed runId=run_20260504_140000_prog steps=5");
    expect(lines.join("\n")).toContain("valid TaskGraph received; artifacts written.");
  });

  it("writes structured failure progress when the planner provider fails", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-plan-progress-fail-"));
    await init(cwd);
    writeFileSync(
      path.join(cwd, ".kiwi", "model-registry.yaml"),
      "models:\n  - id: codex-cli-frontier\n    providerModel: gpt-5.5\n",
      "utf-8",
    );
    const lines: string[] = [];

    await expect(
      runPlan(
        "Implement failed planner progress",
        {
          env: testEnv(cwd, {
            KIWI_FAKE_BINARY_AVAILABLE: "1",
            KIWI_FORCE_ACCESS_MODE: "codex-cli",
            PATH: "/empty",
          }),
          now: new Date("2026-05-04T12:00:00.000Z"),
          runIdSuffix: "fail",
          initiativeIdSuffix: "fail",
          planIdSuffix: "fail",
          progress: {
            enabled: true,
            write: (line) => lines.push(line),
          },
        },
        cwd,
      ),
    ).rejects.toThrow(/codex-cli planner/);

    const output = lines.join("\n");
    expect(output).toContain(
      "phase=planner status=started runId=run_20260504_140000_fail model=codex-cli-frontier provider=codex-cli:gpt-5.5",
    );
    expect(output).toContain("phase=planner status=failed runId=run_20260504_140000_fail error=");
  });

  it("keeps dry-run output as JSON without progress text", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-plan-dry-run-"));
    await init(cwd);
    const progressLines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runPlan(
      "Implement dry-run planning",
      {
        dryRun: true,
        env: testEnv(cwd, { PATH: "/empty" }),
        now: new Date("2026-05-04T12:00:00.000Z"),
        runIdSuffix: "dry1",
        initiativeIdSuffix: "dry1",
        planIdSuffix: "dry1",
        progress: {
          enabled: true,
          write: (line) => progressLines.push(line),
        },
      },
      cwd,
    );

    const output = spy.mock.calls.flat().join("\n");
    spy.mockRestore();
    expect(progressLines).toEqual([]);
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).toContain('"runId": "run_20260504_140000_dry1"');
  });
});
