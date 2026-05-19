import { existsSync } from "fs";
import path from "path";
import type { CoreServices } from "@kiwi/core";
import { ArtifactTypes, ContractValues, ExecutionIsolations } from "@kiwi/contracts";
import type { SandboxServices } from "@kiwi/sandbox";
import type { ExecutionMode, ExecutionTarget } from "./types";

type StepAttemptEvidence = ReturnType<CoreServices["evidence"]["listStepAttempts"]>[number];

export class ExecutionTargetResolver {
  constructor(
    private readonly sandbox: SandboxServices,
    private readonly core: CoreServices,
  ) {}

  create(params: {
    cwd: string;
    runId: string;
    stepId: string;
    attemptId: string;
    repoPath: string;
    mode: ExecutionMode;
  }): ExecutionTarget {
    if (params.mode === ExecutionIsolations.Worktree) {
      const sandbox = this.sandbox.worktrees.create({
        cwd: params.cwd,
        runId: params.runId,
        attemptId: params.attemptId,
        sourcePath: params.repoPath,
      });

      return {
        mode: params.mode,
        runId: params.runId,
        attemptId: params.attemptId,
        worktreePath: sandbox.worktreePath,
        sourcePath: sandbox.sourcePath,
        isolation: sandbox.isolation,
        diffBaseTree: this.prepareCumulativeWorktreeBase({
          cwd: params.cwd,
          runId: params.runId,
          stepId: params.stepId,
          worktreePath: sandbox.worktreePath,
        }),
      };
    }

    return {
      mode: params.mode,
      runId: params.runId,
      attemptId: params.attemptId,
      worktreePath: params.repoPath,
      sourcePath: params.repoPath,
      isolation: ExecutionIsolations.Direct,
      diffBaseTree: this.sandbox.diffs.createGitTreeSnapshot(params.repoPath),
    };
  }

  private acceptedPriorDiffRefs(params: { cwd: string; runId: string; stepId: string }): string[] {
    const taskGraph = this.core.runs.loadTaskGraph(params.runId, params.cwd);
    const targetIndex = taskGraph.steps.findIndex((step) => step.stepId === params.stepId);

    if (targetIndex <= 0) {
      return [];
    }
    const latestAttempts = this.core.evidence.latestAttemptByStep(
      this.core.evidence.listStepAttempts(params.cwd, params.runId),
    );

    return taskGraph.steps
      .slice(0, targetIndex)
      .map((step) => latestAttempts.get(step.stepId))
      .filter(
        (entry): entry is StepAttemptEvidence =>
          entry?.attempt.status === ContractValues.Completed && entry.reviewVerdict?.safeToContinue === true,
      )
      .flatMap((entry) =>
        entry.attempt.artifacts
          .filter((artifact) => artifact.type === ArtifactTypes.Diff)
          .map((artifact) => artifact.ref),
      );
  }

  private prepareCumulativeWorktreeBase(params: {
    cwd: string;
    runId: string;
    stepId: string;
    worktreePath: string;
  }): string | null {
    const diffRefs = this.acceptedPriorDiffRefs(params);

    if (diffRefs.length === 0) {
      return null;
    }
    if (!existsSync(path.join(params.worktreePath, ".git"))) {
      throw new Error("cumulative worktree execution requires a git worktree");
    }

    for (const diffRef of diffRefs) {
      const applied = this.sandbox.diffApplier.applyDiffArtifactToSource({
        cwd: params.cwd,
        runId: params.runId,
        diffRef,
        sourcePath: params.worktreePath,
      });

      if (!applied.applied) {
        throw new Error(`Failed to prepare cumulative worktree base from ${diffRef}: ${applied.reason}`);
      }
    }
    const baseTree = this.sandbox.diffs.createGitTreeSnapshot(params.worktreePath);

    if (!baseTree) {
      throw new Error("Failed to snapshot cumulative worktree base");
    }

    return baseTree;
  }

  teardown(params: { cwd: string; target: ExecutionTarget }): void {
    if (params.target.isolation === ExecutionIsolations.Direct) {
      return;
    }
    this.sandbox.worktrees.teardown({
      cwd: params.cwd,
      runId: params.target.runId,
      attemptId: params.target.attemptId,
      sourcePath: params.target.sourcePath,
      isolation: params.target.isolation,
      worktreePath: params.target.worktreePath,
    });
  }
}
