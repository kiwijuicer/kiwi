import { executeSandboxCommand } from "./command-executor";
import { auditPolicyDecision, blockedOutput, finishCommand } from "./command-artifacts";
import { evaluatePolicy } from "./command-policy";
import type { SandboxCommandInput } from "./command-types";
import {
  DiffArtifactApplier,
  GitDiffArtifactService,
  WorktreeDiffArtifactService,
  readCommandOutputArtifact,
} from "./diff";
import { spawnSandboxCommand } from "./process-execution";
import { terminateProcessTree, truncateOutput } from "./process-utils";
import { createWorktreeSandbox, reapOrphanWorktrees, teardownWorktreeSandbox } from "./worktree";

export class SandboxCommandPolicyEvaluator {
  constructor(
    private readonly deps: {
      evaluatePolicy: typeof evaluatePolicy;
    } = {
      evaluatePolicy,
    },
  ) {}

  evaluate(input: SandboxCommandInput): ReturnType<typeof evaluatePolicy> {
    return this.deps.evaluatePolicy(input);
  }
}

export class SandboxCommandArtifactWriter {
  constructor(
    private readonly deps: {
      auditPolicyDecision: typeof auditPolicyDecision;
      blockedOutput: typeof blockedOutput;
      finishCommand: typeof finishCommand;
    } = {
      auditPolicyDecision,
      blockedOutput,
      finishCommand,
    },
  ) {}

  auditPolicyDecision(...params: Parameters<typeof auditPolicyDecision>): void {
    this.deps.auditPolicyDecision(...params);
  }

  blockedOutput(...params: Parameters<typeof blockedOutput>): ReturnType<typeof blockedOutput> {
    return this.deps.blockedOutput(...params);
  }

  finishCommand(params: Parameters<typeof finishCommand>[0]): ReturnType<typeof finishCommand> {
    return this.deps.finishCommand(params);
  }
}

export class SandboxCommandExecutor {
  constructor(
    private readonly deps: {
      executeSandboxCommand: typeof executeSandboxCommand;
      spawnSandboxCommand: typeof spawnSandboxCommand;
      truncateOutput: typeof truncateOutput;
      terminateProcessTree: typeof terminateProcessTree;
    } = {
      executeSandboxCommand,
      spawnSandboxCommand,
      truncateOutput,
      terminateProcessTree,
    },
  ) {}

  execute(input: SandboxCommandInput): ReturnType<typeof executeSandboxCommand> {
    return this.deps.executeSandboxCommand(input);
  }

  spawn(input: SandboxCommandInput, startedAt: string): ReturnType<typeof spawnSandboxCommand> {
    return this.deps.spawnSandboxCommand(input, startedAt);
  }

  truncateOutput(value: string, maxBytes: number | undefined): string {
    return this.deps.truncateOutput(value, maxBytes);
  }

  terminateProcessTree(...params: Parameters<typeof terminateProcessTree>): ReturnType<typeof terminateProcessTree> {
    return this.deps.terminateProcessTree(...params);
  }
}

export class WorktreeSandboxService {
  constructor(
    private readonly deps: {
      createWorktreeSandbox: typeof createWorktreeSandbox;
      teardownWorktreeSandbox: typeof teardownWorktreeSandbox;
      reapOrphanWorktrees: typeof reapOrphanWorktrees;
    } = {
      createWorktreeSandbox,
      teardownWorktreeSandbox,
      reapOrphanWorktrees,
    },
  ) {}

  create(params: Parameters<typeof createWorktreeSandbox>[0]): ReturnType<typeof createWorktreeSandbox> {
    return this.deps.createWorktreeSandbox(params);
  }

  teardown(params: Parameters<typeof teardownWorktreeSandbox>[0]): ReturnType<typeof teardownWorktreeSandbox> {
    return this.deps.teardownWorktreeSandbox(params);
  }

  reapOrphans(params: Parameters<typeof reapOrphanWorktrees>[0]): ReturnType<typeof reapOrphanWorktrees> {
    return this.deps.reapOrphanWorktrees(params);
  }
}

export class DiffArtifactService {
  constructor(
    private readonly gitDiffArtifacts: GitDiffArtifactService,
    private readonly worktreeDiffArtifacts: WorktreeDiffArtifactService,
    private readonly deps: {
      readCommandOutputArtifact: typeof readCommandOutputArtifact;
    } = {
      readCommandOutputArtifact,
    },
  ) {}

  captureGitDiffArtifact(
    params: Parameters<GitDiffArtifactService["captureGitDiffArtifact"]>[0],
  ): ReturnType<GitDiffArtifactService["captureGitDiffArtifact"]> {
    return this.gitDiffArtifacts.captureGitDiffArtifact(params);
  }

  createGitTreeSnapshot(worktreePath: string): string | null {
    return this.gitDiffArtifacts.createGitTreeSnapshot(worktreePath);
  }

  captureDiffArtifact(
    params: Parameters<GitDiffArtifactService["captureDiffArtifact"]>[0],
  ): ReturnType<GitDiffArtifactService["captureDiffArtifact"]> {
    return this.gitDiffArtifacts.captureDiffArtifact(params);
  }

  captureWorktreeDiffArtifact(
    params: Parameters<WorktreeDiffArtifactService["captureWorktreeDiffArtifact"]>[0],
  ): ReturnType<WorktreeDiffArtifactService["captureWorktreeDiffArtifact"]> {
    return this.worktreeDiffArtifacts.captureWorktreeDiffArtifact(params);
  }

  readCommandOutputArtifact(params: Parameters<typeof readCommandOutputArtifact>[0]): unknown {
    return this.deps.readCommandOutputArtifact(params);
  }
}

export interface SandboxServices {
  policyEvaluator: SandboxCommandPolicyEvaluator;
  commandArtifacts: SandboxCommandArtifactWriter;
  commandExecutor: SandboxCommandExecutor;
  worktrees: WorktreeSandboxService;
  diffs: DiffArtifactService;
  diffApplier: DiffArtifactApplier;
}

export function createSandboxServices(): SandboxServices {
  const gitDiffArtifacts = new GitDiffArtifactService();
  const worktreeDiffArtifacts = new WorktreeDiffArtifactService();

  return {
    policyEvaluator: new SandboxCommandPolicyEvaluator(),
    commandArtifacts: new SandboxCommandArtifactWriter(),
    commandExecutor: new SandboxCommandExecutor(),
    worktrees: new WorktreeSandboxService(),
    diffs: new DiffArtifactService(gitDiffArtifacts, worktreeDiffArtifacts),
    diffApplier: new DiffArtifactApplier(),
  };
}
