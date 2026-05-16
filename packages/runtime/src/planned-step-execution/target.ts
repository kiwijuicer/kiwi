import { ExecutionIsolations } from "@kiwi/contracts";
import type { SandboxServices } from "@kiwi/sandbox";
import type { ExecutionMode, ExecutionTarget } from "./types";

export class ExecutionTargetResolver {
  constructor(private readonly sandbox: SandboxServices) {}

  create(params: {
    cwd: string;
    runId: string;
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
        diffBaseTree: null,
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
