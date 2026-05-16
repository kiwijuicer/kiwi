import { CodexSandboxes, ExecutionIsolations, ExecutionOwners, type KiwiPolicy } from "@kiwi/contracts";
import type { CodexSandboxMode, ExecutionMode, ExecutionOwner } from "./types";

export class ExecutionPolicyResolver {
  readonly directExecutionMode = ExecutionIsolations.Direct;
  readonly worktreeExecutionMode = ExecutionIsolations.Worktree;

  useProviderResearch(): boolean {
    return process.env.KIWI_RESEARCHER_MODE === "provider";
  }

  executionMode(policy: KiwiPolicy): ExecutionMode {
    if (process.env.KIWI_EXECUTION_ISOLATION === ExecutionIsolations.Worktree) {
      return ExecutionIsolations.Worktree;
    }
    if (process.env.KIWI_EXECUTION_ISOLATION === ExecutionIsolations.Direct) {
      return ExecutionIsolations.Direct;
    }

    return policy.execution?.isolation ?? ExecutionIsolations.Direct;
  }

  executionOwner(policy: KiwiPolicy): ExecutionOwner {
    return policy.execution?.owner ?? ExecutionOwners.KiwiCodexCli;
  }

  codexSandbox(policy: KiwiPolicy): CodexSandboxMode {
    return policy.execution?.sandbox ?? CodexSandboxes.WorkspaceWrite;
  }
}
