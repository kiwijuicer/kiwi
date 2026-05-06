import { describe, expect, it } from "vitest";
import { BudgetExceededError } from "../errors";
import { assertWithinBudgetEstimate, estimateAttemptCostUsd } from "../budget-policy";

describe("budget policy pre-flight estimates", () => {
  it("estimates attempt cost from model, capability, and context level", () => {
    expect(
      estimateAttemptCostUsd({
        modelId: "claude-opus-4-6",
        capability: "frontier",
        contextLevel: "L2",
      }),
    ).toBe(0.25);
  });

  it("throws BudgetExceededError when remaining budget is below estimate", () => {
    expect(() =>
      assertWithinBudgetEstimate({
        budgetProfile: "tiny",
        remainingUsdEstimate: 0.1,
        modelId: "claude-opus-4-6",
        modelCapability: "frontier",
        contextLevel: "L2",
      }),
    ).toThrow(BudgetExceededError);
  });

  it("does not throw when remaining budget is unknown", () => {
    expect(() =>
      assertWithinBudgetEstimate({
        budgetProfile: "tiny",
        remainingUsdEstimate: null,
        modelId: "claude-opus-4-6",
        modelCapability: "frontier",
        contextLevel: "L2",
      }),
    ).not.toThrow();
  });
});
