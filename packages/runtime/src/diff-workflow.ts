import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { ArtifactTypes, ContractValues, ReviewVerdictValue } from "@kiwi/contracts";
import {
  appendAuditEvent,
  latestAttemptByStep,
  listStepAttemptEvidence,
  loadInitiative,
  readAuditEvents,
  resolveRunArtifactPath,
} from "@kiwi/core";
import { applyDiffArtifactToSource } from "@kiwi/sandbox";

export interface RunDiffItem {
  stepId: string;
  attemptId: string;
  diffRef: string;
  patchPath: string;
  stat: string;
  patch: string;
  reviewVerdict: ReviewVerdictValue | "missing";
  appliedDuringRun: boolean;
  appliedMode: "direct" | "worktree" | null;
}

export interface RunDiffResult {
  runId: string;
  items: RunDiffItem[];
  stat: string;
  patch: string;
}

export interface ApplyRunDiffResult {
  runId: string;
  applied: Array<{ stepId: string; attemptId: string; diffRef: string; patchPath: string }>;
  skipped: Array<{ stepId: string; attemptId: string; reason: string }>;
  message: string;
}

function patchStat(patchPath: string, patch: string): string {
  try {
    return execFileSync("git", ["apply", "--stat", patchPath], { encoding: "utf-8" }).trim();
  } catch {
    const files = new Set<string>();
    let additions = 0;
    let deletions = 0;

    for (const line of patch.split(/\r?\n/)) {
      if (line.startsWith("+++ b/")) {
        files.add(line.slice("+++ b/".length));
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      }
    }

    return `${files.size} files changed, ${additions} insertions(+), ${deletions} deletions(-)`;
  }
}

function attemptApplyModes(cwd: string, runId: string): Map<string, "direct" | "worktree"> {
  const modes = new Map<string, "direct" | "worktree">();

  for (const event of readAuditEvents(cwd, runId)) {
    if (event.eventType !== "attempt_diff_applied") {
      continue;
    }
    const attemptId = typeof event.payload.attemptId === "string" ? event.payload.attemptId : null;

    if (!attemptId) {
      continue;
    }
    modes.set(attemptId, event.payload.mode === "direct" ? "direct" : "worktree");
  }

  return modes;
}

function selectedAttempts(params: {
  cwd: string;
  runId: string;
  stepId?: string;
  allAttempts?: boolean;
}): ReturnType<typeof listStepAttemptEvidence> {
  const attempts = listStepAttemptEvidence(params.cwd, params.runId).filter(
    (attempt) => !params.stepId || attempt.stepId === params.stepId,
  );

  if (params.allAttempts) {
    return attempts;
  }
  if (params.stepId) {
    const latest = latestAttemptByStep(attempts).get(params.stepId);

    return latest ? [latest] : [];
  }

  return Array.from(latestAttemptByStep(attempts).values()).sort((a, b) => a.stepId.localeCompare(b.stepId));
}

export function buildRunDiff(params: {
  cwd: string;
  runId: string;
  stepId?: string;
  allAttempts?: boolean;
}): RunDiffResult {
  const modes = attemptApplyModes(params.cwd, params.runId);
  const items = selectedAttempts(params).flatMap((attempt): RunDiffItem[] => {
    const diffArtifact = attempt.attempt.artifacts.find((artifact) => artifact.type === ArtifactTypes.Diff);

    if (!diffArtifact) {
      return [];
    }
    const patchPath = resolveRunArtifactPath(params.runId, diffArtifact.ref, params.cwd);

    if (!existsSync(patchPath)) {
      return [];
    }
    const patch = readFileSync(patchPath, "utf-8");
    const appliedMode = modes.get(attempt.attemptId) ?? null;

    return [
      {
        stepId: attempt.stepId,
        attemptId: attempt.attemptId,
        diffRef: diffArtifact.ref,
        patchPath,
        stat: patchStat(patchPath, patch),
        patch,
        reviewVerdict: attempt.reviewVerdict?.verdict ?? "missing",
        appliedDuringRun: appliedMode !== null,
        appliedMode,
      },
    ];
  });

  return {
    runId: params.runId,
    items,
    stat: items
      .map((item) => item.stat)
      .filter(Boolean)
      .join("\n"),
    patch: items.map((item) => item.patch).join("\n"),
  };
}

export function formatRunDiff(result: RunDiffResult): string {
  if (result.items.length === 0) {
    return "no diff artifacts found";
  }

  return result.items
    .map((item) =>
      [`# ${item.stepId}/${item.attemptId}`, item.stat, "", item.patch.trimEnd()]
        .filter((entry) => entry.length > 0)
        .join("\n"),
    )
    .join("\n\n");
}

function blockedVerdict(verdict: ReviewVerdictValue | "missing"): boolean {
  return verdict === ContractValues.NeedsChanges || verdict === ContractValues.Reject;
}

export function applyRunDiff(params: {
  cwd: string;
  runId: string;
  stepId?: string;
  forceUnsafe?: boolean;
}): ApplyRunDiffResult {
  const diffInput: Parameters<typeof buildRunDiff>[0] = { cwd: params.cwd, runId: params.runId };

  if (params.stepId) {
    diffInput.stepId = params.stepId;
  }
  const diff = buildRunDiff(diffInput);

  if (diff.items.length === 0) {
    return { runId: params.runId, applied: [], skipped: [], message: "no diff artifacts found" };
  }

  if (diff.items.every((item) => item.appliedMode === "direct")) {
    return {
      runId: params.runId,
      applied: [],
      skipped: diff.items.map((item) => ({
        stepId: item.stepId,
        attemptId: item.attemptId,
        reason: "already applied during run",
      })),
      message: "already applied during run",
    };
  }

  const blocked = diff.items.find((item) => blockedVerdict(item.reviewVerdict));

  if (blocked && !params.forceUnsafe) {
    throw new Error(
      `Refusing to apply ${blocked.stepId}/${blocked.attemptId}: review verdict is ${blocked.reviewVerdict}. Use --force-unsafe to override.`,
    );
  }

  const repoPath = loadInitiative(params.runId, params.cwd).repoPath || params.cwd;
  const applied: ApplyRunDiffResult["applied"] = [];
  const skipped: ApplyRunDiffResult["skipped"] = [];

  for (const item of diff.items) {
    if (item.appliedMode === "worktree") {
      throw new Error(`Patch already applied for ${item.stepId}/${item.attemptId}.`);
    }
    if (item.appliedMode === "direct") {
      skipped.push({ stepId: item.stepId, attemptId: item.attemptId, reason: "already applied during run" });
      continue;
    }
    const result = applyDiffArtifactToSource({
      cwd: params.cwd,
      runId: params.runId,
      diffRef: item.diffRef,
      sourcePath: repoPath,
    });

    if (!result.applied) {
      appendAuditEvent(params.cwd, {
        eventType: "attempt_diff_apply_failed",
        runId: params.runId,
        timestamp: new Date().toISOString(),
        payload: {
          stepId: item.stepId,
          attemptId: item.attemptId,
          diffRef: item.diffRef,
          targetPath: repoPath,
          reason: result.reason ?? "git apply failed",
        },
      });
      throw new Error(
        `Patch apply failed for ${item.stepId}/${item.attemptId}: ${result.reason ?? "git apply failed"}`,
      );
    }
    if (result.reason === "diff already applied") {
      throw new Error(`Patch already applied for ${item.stepId}/${item.attemptId}.`);
    }
    appendAuditEvent(params.cwd, {
      eventType: "attempt_diff_applied",
      runId: params.runId,
      timestamp: new Date().toISOString(),
      payload: {
        stepId: item.stepId,
        attemptId: item.attemptId,
        diffRef: item.diffRef,
        targetPath: repoPath,
        mode: "worktree",
      },
    });
    applied.push({
      stepId: item.stepId,
      attemptId: item.attemptId,
      diffRef: item.diffRef,
      patchPath: result.patchPath,
    });
  }

  return {
    runId: params.runId,
    applied,
    skipped,
    message: applied.length > 0 ? `applied ${applied.length} patch(es)` : "no pending patches applied",
  };
}
