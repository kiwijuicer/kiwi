import type { McpMutationScope as McpRiskLabel } from "./constants";

export interface RecommendedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpNextAction {
  recommendedToolCall: RecommendedToolCall | null;
  whyThisTool: string;
  requiresUserConfirmation: boolean;
  expectedMutation: McpRiskLabel;
  expectedAfter: string | null;
}

export interface McpMutationScope {
  riskLabel: McpRiskLabel;
  writesRunArtifacts: boolean;
  mutatesWorktree: boolean;
  appliesPatch: boolean;
  pushesBranch: boolean;
  forbidsAutoGitWrites: boolean;
  executionMode: string | null;
  workspacePath: string;
  repoPath: string | null;
  changedFiles: string[];
}

export interface McpRecovery {
  reason: string;
  recommendedToolCall: RecommendedToolCall | null;
  safeAlternatives: RecommendedToolCall[];
  userMessage: string;
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter((entry) => entry[1] !== undefined && entry[1] !== null));
}

export function toolCall(name: string, args: Record<string, unknown>): RecommendedToolCall {
  return { name, arguments: compactObject(args) };
}

export function workspaceToolArgs(params: {
  workspacePath: string;
  repoId?: string | null | undefined;
  repoPath?: string | null | undefined;
  runId?: string | null | undefined;
}): Record<string, unknown> {
  return compactObject({
    workspacePath: params.workspacePath,
    repoId: params.repoId ?? undefined,
    repoPath: params.repoPath ?? undefined,
    runId: params.runId ?? undefined,
  });
}

export function safeReadOnlyToolCalls(params: {
  workspacePath: string;
  runId?: string | null;
  repoId?: string | null;
  repoPath?: string | null;
}): RecommendedToolCall[] {
  const args = workspaceToolArgs(params);

  if (!params.runId) {
    return [toolCall("kiwi_doctor", args)];
  }

  return [
    toolCall("kiwi_status", args),
    toolCall("kiwi_explain", args),
    toolCall("kiwi_diff", args),
    toolCall("kiwi_cost", args),
  ];
}

export function mutationScope(params: {
  riskLabel: McpRiskLabel;
  workspacePath: string;
  repoPath: string | null;
  executionMode?: string | null;
  changedFiles?: string[];
}): McpMutationScope {
  return {
    riskLabel: params.riskLabel,
    writesRunArtifacts: params.riskLabel !== "READ_ONLY",
    mutatesWorktree:
      params.riskLabel === "MUTATES_WORKTREE" ||
      params.riskLabel === "APPLIES_PATCH" ||
      params.riskLabel === "PUSHES_BRANCH",
    appliesPatch: params.riskLabel === "APPLIES_PATCH",
    pushesBranch: params.riskLabel === "PUSHES_BRANCH",
    forbidsAutoGitWrites: true,
    executionMode: params.executionMode ?? null,
    workspacePath: params.workspacePath,
    repoPath: params.repoPath,
    changedFiles: params.changedFiles ?? [],
  };
}

export function resourceLinks(runId: string): Array<{ name: string; uri: string }> {
  return [
    { name: "status", uri: `kiwi://runs/${runId}` },
    { name: "taskGraph", uri: `kiwi://runs/${runId}/task-graph` },
    { name: "attempts", uri: `kiwi://runs/${runId}/attempts` },
    { name: "finalSummary", uri: `kiwi://runs/${runId}/final-summary` },
    { name: "evidenceManifest", uri: `kiwi://runs/${runId}/evidence-manifest` },
    { name: "operatorSnapshot", uri: `kiwi://runs/${runId}/operator-snapshot` },
  ];
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}
