import path from "path";
import { AccessModes } from "@kiwi/contracts";
import {
  isInitialized,
  kiwiHomeModelRegistryPath,
  kiwiHomePolicyPath,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  listRunLocks,
  loadEffectivePolicy,
  loadEffectiveRegistry,
  loadKiwiConfig,
} from "@kiwi/core";
import { evaluateAccessModeAvailability, modelAccessConfigured, readExecutionRepoState } from "@kiwi/runtime";
import { errorMessage } from "./helpers.js";
import { toolCall, workspaceToolArgs } from "../ux/index.js";
import { workspaceArgs } from "../workspace/index.js";

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

const doctorWarnings = {
  addReadiness(params: {
    initialized: boolean;
    hasRepo: boolean;
    policyLoaded: boolean;
    registryLoaded: boolean;
    warnings: string[];
    nextFixes: string[];
  }): void {
    if (!params.initialized) {
      params.warnings.push("workspace is not initialized");
      params.nextFixes.push("Run kiwi init for this workspace.");
    }
    if (!params.hasRepo) {
      params.warnings.push("repo is ambiguous or missing");
      params.nextFixes.push("Pass repoId or repoPath.");
    }
    if (!params.policyLoaded) {
      params.nextFixes.push(
        "Create/fix ~/.kiwi/defaults/policy.yaml, then fix workspace .kiwi/policy.yaml if present.",
      );
    }
    if (!params.registryLoaded) {
      params.nextFixes.push(
        "Create/fix ~/.kiwi/defaults/model-registry.yaml, then fix workspace .kiwi/model-registry.yaml if present.",
      );
    }
  },
  addModels(params: {
    registry: ReturnType<typeof loadEffectiveRegistry> | null;
    warnings: string[];
    nextFixes: string[];
  }): void {
    for (const model of params.registry?.models ?? []) {
      const configured = modelAccessConfigured(model);

      if (model.enabled && !configured.configured) {
        params.warnings.push(`${model.id}: ${configured.reason ?? "model is not configured"}`);
        params.nextFixes.push(
          "Add a workspace model-registry override with a real providerModel or use another access mode.",
        );
      }
    }
  },
  addStaleLocks(params: {
    staleLocks: ReturnType<typeof listRunLocks>;
    warnings: string[];
    nextFixes: string[];
  }): void {
    for (const lock of params.staleLocks) {
      params.warnings.push(`stale run lock: ${lock.runId}`);
      params.nextFixes.push(`Run kiwi runs unlock ${lock.runId} after confirming no owner process is active.`);
    }
  },
  addRepo(params: {
    executionMode: string;
    repoState: ReturnType<typeof readExecutionRepoState> | null;
    warnings: string[];
    nextFixes: string[];
  }): void {
    if (params.executionMode !== "direct" || !params.repoState) {
      return;
    }
    params.warnings.push(...params.repoState.warnings);
    if (params.repoState.protectedBranch) {
      params.nextFixes.push("Switch away from main/master before direct execution.");
    }
    if (params.repoState.dirtyFiles > 0) {
      params.nextFixes.push("Commit/stash changes or use worktree isolation before running.");
    }
  },
  addApprover(params: { approverIdentity: string | null; warnings: string[]; nextFixes: string[] }): void {
    if (process.env.KIWI_MCP_APPROVED_BY || params.approverIdentity) {
      return;
    }
    params.warnings.push("approvedBy identity is not configured");
    params.nextFixes.push("Set KIWI_MCP_APPROVED_BY or run kiwi config set approver <identity>.");
  },
};

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

    doctorWarnings.addReadiness({
      initialized,
      hasRepo: Boolean(workspace.repo),
      policyLoaded: policy.status.loaded,
      registryLoaded: registry.status.loaded,
      warnings,
      nextFixes,
    });
    doctorWarnings.addModels({ registry: registry.value, warnings, nextFixes });
    const staleLocks = initialized ? listRunLocks(workspace.workspacePath).filter((lock) => lock.stale) : [];

    doctorWarnings.addStaleLocks({ staleLocks, warnings, nextFixes });
    const approverIdentity = config?.value?.approver?.identity ?? null;

    doctorWarnings.addApprover({ approverIdentity, warnings, nextFixes });
    const executionMode = policy.value?.execution?.isolation ?? "direct";

    doctorWarnings.addRepo({ executionMode, repoState, warnings, nextFixes });
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
      staleLocks,
      approverIdentity,
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
