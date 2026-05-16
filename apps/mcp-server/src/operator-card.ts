import { existsSync } from "fs";
import { getRunStatusSummary, kiwiPolicyPath, loadInitiative, loadPolicy, resolveRunArtifactPath } from "@kiwi/core";
import { buildRunDiff } from "@kiwi/runtime";
import { buildRunCompletionSummary } from "@kiwi/ops";
import { readRepoState } from "./repo-state";

export interface OperatorCard {
  runId: string;
  workspacePath: string;
  repoPath: string | null;
  status: string;
  executionMode: string | null;
  estimatedCostUsd: number | null;
  changedFiles: string[];
  nextAction: string;
  warnings: string[];
  resources: Array<{ name: string; uri: string }>;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function changedFilesFromPatch(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ b/")) files.push(line.slice("+++ b/".length));
    if (line.startsWith("--- a/")) files.push(line.slice("--- a/".length));
  }
  return uniqueSorted(files.filter((entry) => entry !== "/dev/null"));
}

function resources(runId: string): OperatorCard["resources"] {
  return [
    { name: "status", uri: `kiwi://runs/${runId}` },
    { name: "taskGraph", uri: `kiwi://runs/${runId}/task-graph` },
    { name: "attempts", uri: `kiwi://runs/${runId}/attempts` },
    { name: "finalSummary", uri: `kiwi://runs/${runId}/final-summary` },
    { name: "evidenceManifest", uri: `kiwi://runs/${runId}/evidence-manifest` },
    { name: "operatorSnapshot", uri: `kiwi://runs/${runId}/operator-snapshot` },
  ];
}

export function buildOperatorCard(params: { cwd: string; runId: string }): OperatorCard {
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
  const completion = (() => {
    try {
      return buildRunCompletionSummary({ cwd: params.cwd, runId: params.runId });
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
  if (executionMode === "direct") warnings.push(...repoState.warnings);
  if (!existsSync(resolveRunArtifactPath(params.runId, "final/final-verdict.json", params.cwd))) {
    warnings.push("final verdict is not written yet");
  }

  return {
    runId: params.runId,
    workspacePath: params.cwd,
    repoPath,
    status: latest?.currentStatus ?? "missing",
    executionMode,
    estimatedCostUsd: completion?.totalEstimatedCostUsd ?? null,
    changedFiles: changedFilesFromPatch(diff?.patch ?? ""),
    nextAction: completion?.nextAction ?? latest?.attempts[0]?.nextAction ?? "missing",
    warnings: uniqueSorted(warnings),
    resources: resources(params.runId),
  };
}

export function withOperatorCard<T extends object>(
  result: T,
  params: { cwd: string; runId: string },
): T & { operatorCard: OperatorCard } {
  return {
    ...result,
    operatorCard: buildOperatorCard(params),
  };
}
