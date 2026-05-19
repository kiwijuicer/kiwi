import { describe, expect, it } from "vitest";
import type { KiwiPolicy } from "@kiwi/contracts";
import { runRequiredGates } from "../../gates/required-gates";

const policy: KiwiPolicy = {
  version: "1",
  project: { name: "kiwi", language: "typescript", packageManager: "pnpm" },
  commands: { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
  routing: {
    defaultAgentRole: "executor",
    defaultModelCapability: "mid",
    providerPreference: {},
    stepTypeOverrides: {},
  },
  riskZones: { high: [] },
  approvals: { requireFor: [], commandApprovalStates: {} },
  commandProfiles: {},
};

describe("runRequiredGates", () => {
  it("persists blocked results for unknown or unsupported required gates", async () => {
    const result = await runRequiredGates({
      cwd: process.cwd(),
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_demo",
      worktreePath: process.cwd(),
      policy,
      requiredGates: ["unknown_gate", "structured_review_json"],
      approved: false,
      diffHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(result.gateResults).toHaveLength(2);
    expect(result.gateResults.map((gate) => gate.status)).toEqual(["blocked", "blocked"]);
    expect(result.gateResults[0]?.reason).toContain("not a known gate type");
    expect(result.gateResults[1]?.reason).toContain("no executable command configured");
  });
});
