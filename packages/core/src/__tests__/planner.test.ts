import { describe, expect, it } from "vitest";
import { KiwiPolicy } from "@ai-kiwi/contracts";
import {
  buildDeterministicTaskGraph,
  createInitiativeFromInput,
} from "../planner";

const policy: KiwiPolicy = {
  version: "1",
  project: {
    name: "ai-kiwi",
    language: "typescript",
    packageManager: "pnpm",
  },
  commands: {
    test: "pnpm test",
    lint: "pnpm lint",
    typecheck: "pnpm typecheck",
  },
  routing: {
    defaultAgentRole: "executor",
    defaultModelCapability: "mid",
    stepTypeOverrides: {
      planning: {
        agentRole: "planner",
        modelCapability: "frontier",
      },
    },
  },
  riskZones: { high: [] },
  approvals: { requireFor: [], commandApprovalStates: {} },
  commandProfiles: {},
};

describe("deterministic planner", () => {
  it("creates initiative and taskgraph from markdown", () => {
    const rawInput = `# Feature: permissions

## Analyze current behavior
## Plan rollout
## Add tests
## Implement changes
## Validate result`;

    const initiative = createInitiativeFromInput({
      rawInput,
      repoPath: "/tmp/repo",
      source: "file",
      now: new Date("2026-05-03T19:00:00.000Z"),
    });

    const graph = buildDeterministicTaskGraph({
      runId: "run_20260503_190000_abcd",
      initiative,
      policy,
      now: new Date("2026-05-03T19:00:00.000Z"),
    });

    expect(graph.steps.length).toBe(5);
    expect(graph.steps[0]?.stepId).toBe("step_001");
    expect(graph.steps[1]?.dependsOn).toEqual(["step_001"]);
    expect(graph.initiativeId).toBe(initiative.id);
    expect(graph.assumptions).toEqual([]);
    expect(graph.openQuestions).toEqual([]);
    expect(graph.riskScore).toBeGreaterThanOrEqual(1);
    expect(graph.complexityScore).toBeGreaterThanOrEqual(1);
    expect(graph.steps.every((step) => step.successCriteria.length >= 1)).toBe(true);
    expect(graph.steps.some((step) => step.requiredGates.length > 0)).toBe(true);
  });

  it("is reproducible for fixed input and fixed time", () => {
    const fixedNow = new Date("2026-05-03T19:00:00.000Z");
    const initiative = createInitiativeFromInput({
      rawInput: "# Feature: deterministic\n\n## Plan\n## Implement\n## Validate",
      repoPath: "/tmp/repo",
      source: "cli",
      now: fixedNow,
      idSuffix: "fixed",
    });

    const first = buildDeterministicTaskGraph({
      runId: "run_20260503_190000_fixed",
      initiative,
      policy,
      now: fixedNow,
      planIdSuffix: "fixed",
    });
    const second = buildDeterministicTaskGraph({
      runId: "run_20260503_190000_fixed",
      initiative,
      policy,
      now: fixedNow,
      planIdSuffix: "fixed",
    });

    expect(second).toEqual(first);
    expect(first.planId).toBe("plan_20260503_190000_fixed");
    expect(first.initiativeId).toBe("init_20260503_190000_fixed");
  });

  it("captures constraints section as acceptance criteria", () => {
    const initiative = createInitiativeFromInput({
      rawInput: `# Ticket

Constraints:
- Keep CLI output readable
- No network calls in planning
`,
      repoPath: "/tmp/repo",
      source: "file",
      now: new Date("2026-05-03T19:00:00.000Z"),
    });

    const graph = buildDeterministicTaskGraph({
      runId: "run_20260503_190000_abcd",
      initiative,
      policy,
      now: new Date("2026-05-03T19:00:00.000Z"),
    });

    expect(graph.acceptanceCriteria).toEqual([
      "Keep CLI output readable",
      "No network calls in planning",
    ]);
  });

  it("routes code orchestration and SCM publication steps explicitly", () => {
    const initiative = createInitiativeFromInput({
      rawInput: `# Bitbucket flow

## Create new CLI command code
## Refactor runner adapter
## Modify validation behavior
## Create Bitbucket ticket
## Create pull request
## Publish review comments
`,
      repoPath: "/tmp/repo",
      source: "cli",
      now: new Date("2026-05-03T19:00:00.000Z"),
    });

    const graph = buildDeterministicTaskGraph({
      runId: "run_20260503_190000_abcd",
      initiative,
      policy,
      now: new Date("2026-05-03T19:00:00.000Z"),
    });

    expect(graph.steps.map((step) => step.type)).toEqual([
      "code_creation",
      "refactoring",
      "code_modification",
      "scm_ticket",
      "scm_pull_request",
      "scm_review",
    ]);
    expect(graph.steps[0]?.requiredGates).toEqual(["typecheck", "lint", "tests"]);
    expect(graph.steps[3]?.requiredGates).toEqual([]);
  });
});
