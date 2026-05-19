import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import type { Initiative, Step } from "@kiwi/contracts";
import { ExecutionContextRetriever } from "../../execution/planned-steps/context-retriever.js";

const initiative: Initiative = {
  id: "init_demo",
  title: "Payment",
  rawInput: "Update PaymentService behavior",
  source: "cli",
  repoPath: "",
  riskProfile: "dev",
  budgetProfile: "normal",
  createdAt: "2026-05-19T00:00:00.000Z",
};

const step: Step = {
  stepId: "step_001",
  type: "coding",
  title: "Modify PaymentService",
  dependsOn: [],
  successCriteria: ["PaymentService updated"],
  requiredGates: [],
  recommendedAgentRole: "executor",
  recommendedModelCapability: "strong",
  status: "pending",
};

describe("ExecutionContextRetriever", () => {
  it("finds deterministic rg matches with retrieval reasons", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "kiwi-context-retriever-"));
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src", "payment.ts"), "export class PaymentService {}\n", "utf-8");
    writeFileSync(path.join(repo, "package.json"), '{"name":"demo"}\n', "utf-8");

    const result = new ExecutionContextRetriever({ maxTokens: 4 }).retrieve({
      repoPath: repo,
      initiative: { ...initiative, repoPath: repo },
      step,
    });

    expect(result.relevantFiles).toContain("src/payment.ts");
    expect(result.retrievalFiles).toContainEqual({ path: "src/payment.ts", reason: "rg-match" });
  });
});
