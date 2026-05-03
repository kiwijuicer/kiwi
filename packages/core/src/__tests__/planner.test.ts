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
  approvals: { requireFor: [] },
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
  });
});
