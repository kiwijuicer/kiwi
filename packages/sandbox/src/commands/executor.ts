import { mkdirSync } from "fs";
import { auditPolicyDecision, blockedOutput } from "./artifacts.js";
import { evaluatePolicy } from "./policy.js";
import { SandboxPolicyDecisionStatuses } from "../constants.js";
import { spawnSandboxCommand } from "../processes/execution.js";
import type { SandboxCommandInput, SandboxCommandOutput } from "./types.js";

export type {
  ApprovalState,
  NetworkPolicy,
  SandboxCommandInput,
  SandboxCommandOutput,
  SandboxCommandPolicy,
  SandboxExecutionStatus,
} from "./types.js";

export async function executeSandboxCommand(input: SandboxCommandInput): Promise<SandboxCommandOutput> {
  const startedAt = (input.now ?? new Date()).toISOString();
  const policyDecision = evaluatePolicy(input);
  auditPolicyDecision(input, startedAt, policyDecision);
  if (policyDecision.status === SandboxPolicyDecisionStatuses.Allow) {
    mkdirSync(input.worktreePath, { recursive: true });

    return spawnSandboxCommand(input, startedAt);
  }

  return blockedOutput(input, startedAt, policyDecision);
}
