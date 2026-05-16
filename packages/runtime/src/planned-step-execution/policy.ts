import type { KiwiPolicy } from "@kiwi/contracts";
import type { CodexSandboxMode, ExecutionMode, ExecutionOwner } from "./types";

export class ExecutionPolicyResolver {
  useProviderResearch(): boolean {
    return process.env.KIWI_RESEARCHER_MODE === "provider";
  }

  executionMode(policy: KiwiPolicy): ExecutionMode {
    if (process.env.KIWI_EXECUTION_ISOLATION === "worktree") {
      return "worktree";
    }
    if (process.env.KIWI_EXECUTION_ISOLATION === "direct") {
      return "direct";
    }

    return policy.execution?.isolation ?? "direct";
  }

  executionOwner(policy: KiwiPolicy): ExecutionOwner {
    return policy.execution?.owner ?? "kiwi-codex-cli";
  }

  codexSandbox(policy: KiwiPolicy): CodexSandboxMode {
    return policy.execution?.sandbox ?? "workspace-write";
  }
}
