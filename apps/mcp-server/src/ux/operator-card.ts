import { existsSync } from "fs";
import { ContractValues } from "@kiwi/contracts";
import { getRunStatusSummary, loadEffectivePolicy, loadInitiative, resolveRunArtifactPath } from "@kiwi/core";
import { buildRunActivityTimeline } from "@kiwi/ops";
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
  stepsSummary: {
    total: number;
    completed: number;
    running: number;
    blocked: number;
    failed: number;
    current: string | null;
  } | null;
  mutationScope: McpMutationScope;
  warnings: string[];
  resources: Array<{ name: string; uri: string }>;
}

interface BuildOperatorCardParams {
  cwd: string;
  runId: string;
  lastAction?: string;
  nextAction?: McpNextAction;
  mutationScope?: McpMutationScope;
  blockedBy?: string[];
}

class OperatorCardBuilder {
  constructor(private readonly params: BuildOperatorCardParams) {}

  build(): OperatorCard {
    const warnings: string[] = [];
    const latest = getRunStatusSummary(this.params.cwd, this.params.runId).latest[0];
    const initiative = (() => {
      try {
        return loadInitiative(this.params.runId, this.params.cwd);
      } catch {
        return null;
      }
    })();
    const policy = (() => {
      try {
        return loadEffectivePolicy(this.params.cwd);
      } catch {
        return null;
      }
    })();
    const repoPath = initiative?.repoPath || this.params.cwd;
    const executionMode = policy?.execution?.isolation ?? "direct";
    const repoState = readExecutionRepoState(repoPath);
    const currentState = latest?.currentStatus ?? "missing";

    if (executionMode === "direct") {
      warnings.push(...repoState.warnings);
    }
    if (
      currentState === ContractValues.Completed &&
      !existsSync(resolveRunArtifactPath(this.params.runId, "final/final-verdict.json", this.params.cwd))
    ) {
      warnings.push("final verdict is not written yet");
    }

    return {
      schemaVersion: "2",
      runId: this.params.runId,
      workspacePath: this.params.cwd,
      repoPath,
      currentState,
      lastAction: this.params.lastAction ?? null,
      nextAction: this.params.nextAction ?? {
        recommendedToolCall: toolCall("kiwi_next", {
          workspacePath: this.params.cwd,
          runId: this.params.runId,
        }),
        whyThisTool: "kiwi_next is the read-only router for the current safe action.",
        requiresUserConfirmation: false,
        expectedMutation: "READ_ONLY",
        expectedAfter: "Follow the recommendedToolCall returned by kiwi_next.",
      },
      blockedBy: this.uniqueSorted(this.params.blockedBy ?? []),
      stepsSummary: this.buildStepsSummary(),
      mutationScope:
        this.params.mutationScope ??
        mutationScope({
          riskLabel: "READ_ONLY",
          workspacePath: this.params.cwd,
          repoPath,
          executionMode,
        }),
      warnings: this.uniqueSorted(warnings),
      resources: this.resourceLinks(),
    };
  }

  private uniqueSorted(values: string[]): string[] {
    return Array.from(new Set(values)).sort();
  }

  private resourceLinks(): Array<{ name: string; uri: string }> {
    return [
      { name: "status", uri: `kiwi://runs/${this.params.runId}` },
      { name: "taskGraph", uri: `kiwi://runs/${this.params.runId}/task-graph` },
      { name: "activityTimeline", uri: `kiwi://runs/${this.params.runId}/activity-timeline` },
      { name: "attempts", uri: `kiwi://runs/${this.params.runId}/attempts` },
      { name: "finalSummary", uri: `kiwi://runs/${this.params.runId}/final-summary` },
      { name: "evidenceManifest", uri: `kiwi://runs/${this.params.runId}/evidence-manifest` },
      { name: "operatorSnapshot", uri: `kiwi://runs/${this.params.runId}/operator-snapshot` },
    ];
  }

  private buildStepsSummary(): OperatorCard["stepsSummary"] {
    try {
      const timeline = buildRunActivityTimeline({ cwd: this.params.cwd, runId: this.params.runId });
      const current =
        timeline.activities.find((activity) => activity.status === ContractValues.Running)?.title ??
        timeline.activities.find((activity) => activity.status === ContractValues.Blocked)?.title ??
        timeline.activities.find((activity) => activity.status === ContractValues.Failed)?.title ??
        null;

      return {
        total: timeline.summary.total,
        completed: timeline.summary.completed,
        running: timeline.summary.running,
        blocked: timeline.summary.blocked,
        failed: timeline.summary.failed,
        current,
      };
    } catch {
      return null;
    }
  }
}

export function buildOperatorCard(params: BuildOperatorCardParams): OperatorCard {
  return new OperatorCardBuilder(params).build();
}

export function withOperatorCard<T extends object>(
  result: T,
  params: BuildOperatorCardParams,
): T & { operatorCard: OperatorCard } {
  return {
    ...result,
    operatorCard: buildOperatorCard(params),
  };
}
