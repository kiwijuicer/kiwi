import { existsSync } from "fs";
import { getRunStatusSummary, kiwiPolicyPath, loadInitiative, loadPolicy, resolveRunArtifactPath } from "@kiwi/core";
import { buildRunDiff } from "@kiwi/runtime";
import { readRepoState } from "./repo-state";
import {
  defaultNextAction,
  type McpMutationScope,
  type McpNextAction,
  mutationScope,
  resourceLinks,
  uniqueSorted,
} from "./ux";

export interface OperatorCard {
  schemaVersion: "2";
  runId: string;
  workspacePath: string;
  repoPath: string | null;
  currentState: string;
  lastAction: string | null;
  nextAction: McpNextAction;
  blockedBy: string[];
  mutationScope: McpMutationScope;
  warnings: string[];
  resources: Array<{ name: string; uri: string }>;
}

function changedFilesFromPatch(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ b/")) files.push(line.slice("+++ b/".length));
    if (line.startsWith("--- a/")) files.push(line.slice("--- a/".length));
  }
  return uniqueSorted(files.filter((entry) => entry !== "/dev/null"));
}

export function buildOperatorCard(params: {
  cwd: string;
  runId: string;
  lastAction?: string;
  nextAction?: McpNextAction;
  mutationScope?: McpMutationScope;
  blockedBy?: string[];
}): OperatorCard {
  const warnings: string[] = [];
  const latest = getRunStatusSummary(params.cwd, params.runId).latest[0];
  const initiative = (() => {
    try {
      return loadInitiative(params.runId, params.cwd);
    } catch {
      return null;
    }
  })();
  const policy = (() => {
    try {
      return loadPolicy(kiwiPolicyPath(params.cwd));
    } catch {
      return null;
    }
  })();
  const diff = (() => {
    try {
      return buildRunDiff({ cwd: params.cwd, runId: params.runId });
    } catch {
      return null;
    }
  })();
  const repoPath = initiative?.repoPath || params.cwd;
  const executionMode = policy?.execution?.isolation ?? "direct";
  const repoState = readRepoState(repoPath);
  const changedFiles = changedFilesFromPatch(diff?.patch ?? "");
  if (executionMode === "direct") warnings.push(...repoState.warnings);
  if (!existsSync(resolveRunArtifactPath(params.runId, "final/final-verdict.json", params.cwd))) {
    warnings.push("final verdict is not written yet");
  }

  return {
    schemaVersion: "2",
    runId: params.runId,
    workspacePath: params.cwd,
    repoPath,
    currentState: latest?.currentStatus ?? "missing",
    lastAction: params.lastAction ?? null,
    nextAction: params.nextAction ?? defaultNextAction({ workspacePath: params.cwd, runId: params.runId }),
    blockedBy: uniqueSorted(params.blockedBy ?? []),
    mutationScope:
      params.mutationScope ??
      mutationScope({
        riskLabel: "READ_ONLY",
        workspacePath: params.cwd,
        repoPath,
        executionMode,
        changedFiles,
      }),
    warnings: uniqueSorted(warnings),
    resources: resourceLinks(params.runId),
  };
}

export function withOperatorCard<T extends object>(
  result: T,
  params: Parameters<typeof buildOperatorCard>[0],
): T & { operatorCard: OperatorCard } {
  return {
    ...result,
    operatorCard: buildOperatorCard(params),
  };
}
