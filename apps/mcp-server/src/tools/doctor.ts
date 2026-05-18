import path from "path";
import { AccessModes } from "@kiwi/contracts";
import {
  isInitialized,
  kiwiHomeModelRegistryPath,
  kiwiHomePolicyPath,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  loadEffectivePolicy,
  loadEffectiveRegistry,
  loadKiwiConfig,
} from "@kiwi/core";
import { evaluateAccessModeAvailability, readExecutionRepoState } from "@kiwi/runtime";
import { errorMessage } from "./helpers";
import { toolCall, workspaceToolArgs } from "../ux";
import { workspaceArgs } from "../workspace";

interface FileStatus {
  path: string;
  loaded: boolean;
  error?: string;
}

function configStatus<T>(pathValue: string, load: () => T): { status: FileStatus; value: T | null } {
  try {
    return { status: { path: pathValue, loaded: true }, value: load() };
  } catch (error) {
    return { status: { path: pathValue, loaded: false, error: errorMessage(error) }, value: null };
  }
}

function layeredPathLabel(homePath: string, workspacePath: string): string {
  return `${homePath} + ${workspacePath} override`;
}

function policyStatus(workspacePath: string): {
  status: FileStatus;
  value: ReturnType<typeof loadEffectivePolicy> | null;
} {
  const homePath = kiwiHomePolicyPath();
  const localPath = kiwiPolicyPath(workspacePath);

  return configStatus(layeredPathLabel(homePath, localPath), () => loadEffectivePolicy(workspacePath));
}

function registryStatus(workspacePath: string): {
  status: FileStatus;
  value: ReturnType<typeof loadEffectiveRegistry> | null;
} {
  const homePath = kiwiHomeModelRegistryPath();
  const localPath = kiwiModelRegistryPath(workspacePath);

  return configStatus(layeredPathLabel(homePath, localPath), () => loadEffectiveRegistry(workspacePath));
}

export function doctorTool(args: Record<string, unknown>, cwd: string): unknown {
  const warnings: string[] = [];
  const nextFixes: string[] = [];

  try {
    const workspace = workspaceArgs(args, cwd, false);
    const initialized = isInitialized(workspace.workspacePath);
    const policy = policyStatus(workspace.workspacePath);
    const registry = registryStatus(workspace.workspacePath);
    const config = initialized
      ? configStatus(path.join(workspace.workspacePath, ".kiwi", "config.yaml"), () =>
          loadKiwiConfig(path.join(workspace.workspacePath, ".kiwi", "config.yaml")),
        )
      : null;
    const repoPath = workspace.repo?.path ?? null;
    const repoState = repoPath ? readExecutionRepoState(repoPath) : null;

    if (!initialized) {
      warnings.push("workspace is not initialized");
      nextFixes.push("Run kiwi init for this workspace.");
    }
    if (!workspace.repo) {
      warnings.push("repo is ambiguous or missing");
      nextFixes.push("Pass repoId or repoPath.");
    }
    if (!policy.status.loaded) {
      nextFixes.push("Create/fix ~/.kiwi/defaults/policy.yaml, then fix workspace .kiwi/policy.yaml if present.");
    }
    if (!registry.status.loaded) {
      nextFixes.push(
        "Create/fix ~/.kiwi/defaults/model-registry.yaml, then fix workspace .kiwi/model-registry.yaml if present.",
      );
    }
    const executionMode = policy.value?.execution?.isolation ?? "direct";

    if (executionMode === "direct" && repoState) {
      warnings.push(...repoState.warnings);
      if (repoState.protectedBranch) {
        nextFixes.push("Switch away from main/master before direct execution.");
      }
      if (repoState.dirtyFiles > 0) {
        nextFixes.push("Commit/stash changes or use worktree isolation before running.");
      }
    }
    const cliAvailability = [
      { client: "codex", ...evaluateAccessModeAvailability(AccessModes.CodexCli, process.env) },
      { client: "claude", ...evaluateAccessModeAvailability(AccessModes.ClaudeCodeCli, process.env) },
      { client: "cursor", ...evaluateAccessModeAvailability(AccessModes.CursorAgentCli, process.env) },
    ];
    const safeToPlan = initialized && Boolean(workspace.repo) && policy.status.loaded && registry.status.loaded;
    const safeToRun =
      safeToPlan &&
      (!repoState ||
        executionMode !== "direct" ||
        (repoState.isGitRepo && !repoState.protectedBranch && repoState.dirtyFiles === 0));
    const planArguments = workspaceToolArgs({
      workspacePath: workspace.workspacePath,
      repoId: workspace.repo?.id,
      repoPath: workspace.repo?.path,
    });
    const recommendedFirstToolCall = safeToPlan
      ? null
      : toolCall("kiwi_doctor", { workspacePath: workspace.workspacePath });

    return {
      schemaVersion: "2",
      workspacePath: workspace.workspacePath,
      repos: workspace.repos,
      repo: workspace.repo ?? null,
      initialized,
      config: config?.status ?? null,
      policy: policy.status,
      registry: registry.status,
      executionMode,
      git: repoState,
      cliAvailability,
      safeToPlan,
      safeToRun,
      warnings: Array.from(new Set(warnings)).sort(),
      nextFixes: Array.from(new Set(nextFixes)).sort(),
      recommendedFirstToolCall,
      readyForTool: safeToPlan
        ? {
            name: "kiwi_plan",
            arguments: planArguments,
            requiredInput: "ticket or rawInput",
          }
        : null,
    };
  } catch (error) {
    return {
      schemaVersion: "2",
      safeToPlan: false,
      safeToRun: false,
      warnings: ["workspace resolution failed"],
      nextFixes: ["Pass a valid workspacePath and, for multi-repo workspaces, repoId or repoPath."],
      error: errorMessage(error),
    };
  }
}
