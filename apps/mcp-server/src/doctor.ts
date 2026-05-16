import path from "path";
import { AccessModes } from "@kiwi/contracts";
import {
  isInitialized,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  loadKiwiConfig,
  loadPolicy,
  loadRegistry,
} from "@kiwi/core";
import { evaluateAccessModeAvailability } from "@kiwi/runtime";
import { readRepoState } from "./repo-state";
import { toolCall, workspaceToolArgs } from "./ux";
import { workspaceArgs } from "./workspace";

interface FileStatus {
  path: string;
  loaded: boolean;
  error?: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configStatus<T>(pathValue: string, load: () => T): { status: FileStatus; value: T | null } {
  try {
    return { status: { path: pathValue, loaded: true }, value: load() };
  } catch (error) {
    return { status: { path: pathValue, loaded: false, error: errorText(error) }, value: null };
  }
}

export function doctorTool(args: Record<string, unknown>, cwd: string): unknown {
  const warnings: string[] = [];
  const nextFixes: string[] = [];

  try {
    const workspace = workspaceArgs(args, cwd, false);
    const initialized = isInitialized(workspace.workspacePath);
    const policyPath = kiwiPolicyPath(workspace.workspacePath);
    const registryPath = kiwiModelRegistryPath(workspace.workspacePath);
    const policy = configStatus(policyPath, () => loadPolicy(policyPath));
    const registry = configStatus(registryPath, () => loadRegistry(registryPath));
    const config = initialized
      ? configStatus(path.join(workspace.workspacePath, ".kiwi", "config.yaml"), () =>
          loadKiwiConfig(path.join(workspace.workspacePath, ".kiwi", "config.yaml")),
        )
      : null;
    const repoPath = workspace.repo?.path ?? null;
    const repoState = repoPath ? readRepoState(repoPath) : null;

    if (!initialized) {
      warnings.push("workspace is not initialized");
      nextFixes.push("Run kiwi init for this workspace.");
    }
    if (!workspace.repo) {
      warnings.push("repo is ambiguous or missing");
      nextFixes.push("Pass repoId or repoPath.");
    }
    if (!policy.status.loaded) {
      nextFixes.push("Fix or create .kiwi/policy.yaml.");
    }
    if (!registry.status.loaded) {
      nextFixes.push("Fix or create .kiwi/model-registry.yaml.");
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
    const recommendedFirstToolCall = safeToPlan
      ? toolCall(
          "kiwi_plan",
          workspaceToolArgs({
            workspacePath: workspace.workspacePath,
            repoId: workspace.repo?.id,
            repoPath: workspace.repo?.path,
          }),
        )
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
    };
  } catch (error) {
    return {
      schemaVersion: "2",
      safeToPlan: false,
      safeToRun: false,
      warnings: ["workspace resolution failed"],
      nextFixes: ["Pass a valid workspacePath and, for multi-repo workspaces, repoId or repoPath."],
      error: errorText(error),
    };
  }
}
