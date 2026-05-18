import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetExceededError, NotInitializedError, RunNotFoundError } from "@kiwi/core";
import { handleCommandError, mapErrorToHelp } from "../../commands/registration/common";

afterEach(() => {
  vi.restoreAllMocks();
});

function captureHandleCommandError(error: unknown): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((value?: unknown) => {
    lines.push(String(value ?? ""));
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as never);
  expect(() => handleCommandError(error)).toThrow("process.exit:1");

  return lines;
}

describe("register-common error hints", () => {
  it("maps provider auth and known model errors to actionable help", () => {
    expect(mapErrorToHelp(Object.assign(new Error("auth failed"), { code: "provider_auth" }))).toContain("/login");
    expect(
      mapErrorToHelp(
        new Error("No real planner model with an available access mode found in the effective model registry"),
      ),
    ).toContain("kiwi doctor");
  });

  it("prints an init hint for uninitialized workspaces", () => {
    const output = captureHandleCommandError(new NotInitializedError("/tmp/demo"));
    expect(output.join("\n")).toMatchInlineSnapshot(`
      "
      ✗ Project is not initialized at /tmp/demo. Run 'kiwi init' first.
        hint: Run \`kiwi init [--workspace ...]\`."
    `);
  });

  it("prints a lookup hint for missing runs", () => {
    const output = captureHandleCommandError(new RunNotFoundError("run_missing"));
    expect(output.join("\n")).toMatchInlineSnapshot(`
      "
      ✗ Run not found: run_missing
        hint: List runs with \`kiwi status\` or pick a different \`runId\`."
    `);
  });

  it("maps budget exceeded errors to budget guidance", () => {
    expect(
      mapErrorToHelp(
        new BudgetExceededError({
          budgetProfile: "tiny",
          remainingUsdEstimate: 0.1,
          estimatedAttemptCostUsd: 0.25,
          modelId: "claude-opus-4-6",
          modelCapability: "frontier",
          contextLevel: "L2",
        }),
      ),
    ).toContain("--budget-profile");
  });
});
