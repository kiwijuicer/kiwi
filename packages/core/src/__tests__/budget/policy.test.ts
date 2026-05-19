import { describe, expect, it } from "vitest";
import { BudgetExceededError } from "../../errors.js";
import { firstBudgetProfileForCost } from "../../budget/forecast.js";
import { assertWithinBudgetEstimate, estimateAttemptCostUsd } from "../../budget/policy.js";

const frontierModel = {
  id: "claude-opus-4-6",
  providerModel: "claude-opus-4-6",
  pricing: { currency: "USD", inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
} as const;

describe("budget policy pre-flight estimates", () => {
  it("estimates attempt cost from model, capability, and context level", () => {
    expect(
      estimateAttemptCostUsd({
        model: frontierModel,
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
        model: frontierModel,
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
        model: frontierModel,
        modelCapability: "frontier",
        contextLevel: "L2",
      }),
    ).not.toThrow();
  });

  it("finds the first budget profile that can hold an estimated cost", () => {
    expect(firstBudgetProfileForCost(0.4)).toBe("tiny");
    expect(firstBudgetProfileForCost(3)).toBe("normal");
  });
});
