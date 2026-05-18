import { mkdirSync } from "fs";
import { auditPolicyDecision, blockedOutput } from "./artifacts";
import { evaluatePolicy } from "./policy";
import { SandboxPolicyDecisionStatuses } from "../constants";
import { spawnSandboxCommand } from "../processes/execution";
import type { SandboxCommandInput, SandboxCommandOutput } from "./types";

export type {
  ApprovalState,
  NetworkPolicy,
  SandboxCommandInput,
  SandboxCommandOutput,
  SandboxCommandPolicy,
  SandboxExecutionStatus,
} from "./types";

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
