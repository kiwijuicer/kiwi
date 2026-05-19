import { existsSync } from "fs";
import { ContractValues } from "@kiwi/contracts";
import { getRunStatusSummary, loadEffectivePolicy, loadInitiative, resolveRunArtifactPath } from "@kiwi/core";
import { readExecutionRepoState } from "@kiwi/runtime";
import { type McpMutationScope, type McpNextAction, mutationScope, toolCall } from "./index.js";

interface OperatorCard {
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

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function resourceLinks(runId: string): Array<{ name: string; uri: string }> {
  return [
    { name: "status", uri: `kiwi://runs/${runId}` },
    { name: "taskGraph", uri: `kiwi://runs/${runId}/task-graph` },
    { name: "attempts", uri: `kiwi://runs/${runId}/attempts` },
    { name: "finalSummary", uri: `kiwi://runs/${runId}/final-summary` },
    { name: "evidenceManifest", uri: `kiwi://runs/${runId}/evidence-manifest` },
    { name: "operatorSnapshot", uri: `kiwi://runs/${runId}/operator-snapshot` },
  ];
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
      return loadEffectivePolicy(params.cwd);
    } catch {
      return null;
    }
  })();
  const repoPath = initiative?.repoPath || params.cwd;
  const executionMode = policy?.execution?.isolation ?? "direct";
  const repoState = readExecutionRepoState(repoPath);
  const currentState = latest?.currentStatus ?? "missing";

  if (executionMode === "direct") {
    warnings.push(...repoState.warnings);
  }
  if (
    currentState === ContractValues.Completed &&
    !existsSync(resolveRunArtifactPath(params.runId, "final/final-verdict.json", params.cwd))
  ) {
    warnings.push("final verdict is not written yet");
  }

  return {
    schemaVersion: "2",
    runId: params.runId,
    workspacePath: params.cwd,
    repoPath,
    currentState,
    lastAction: params.lastAction ?? null,
    nextAction: params.nextAction ?? {
      recommendedToolCall: toolCall("kiwi_next", {
        workspacePath: params.cwd,
        runId: params.runId,
      }),
      whyThisTool: "kiwi_next is the read-only router for the current safe action.",
      requiresUserConfirmation: false,
      expectedMutation: "READ_ONLY",
      expectedAfter: "Follow the recommendedToolCall returned by kiwi_next.",
    },
    blockedBy: uniqueSorted(params.blockedBy ?? []),
    mutationScope:
      params.mutationScope ??
      mutationScope({
        riskLabel: "READ_ONLY",
        workspacePath: params.cwd,
        repoPath,
        executionMode,
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
