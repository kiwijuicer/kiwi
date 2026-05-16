import { mkdirSync } from "fs";
import { auditPolicyDecision, blockedOutput } from "./command-artifacts";
import { evaluatePolicy } from "./command-policy";
import { spawnSandboxCommand } from "./process-execution";
import type { SandboxCommandInput, SandboxCommandOutput } from "./command-types";

export type {
  ApprovalState,
  NetworkPolicy,
  SandboxCommandInput,
  SandboxCommandOutput,
  SandboxCommandPolicy,
  SandboxExecutionStatus,
} from "./command-types";

export async function executeSandboxCommand(input: SandboxCommandInput): Promise<SandboxCommandOutput> {
  const startedAt = (input.now ?? new Date()).toISOString();
  const policyDecision = evaluatePolicy(input);
  auditPolicyDecision(input, startedAt, policyDecision);
  if (policyDecision.status === "allow") {
    mkdirSync(input.worktreePath, { recursive: true });

    return spawnSandboxCommand(input, startedAt);
  }

  return blockedOutput(input, startedAt, policyDecision);
}
