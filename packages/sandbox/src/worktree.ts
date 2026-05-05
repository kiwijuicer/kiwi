import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from "fs";
import path from "path";
import { appendAuditEvent, resolveRunArtifactPath } from "./common";

export interface WorktreeSandbox {
  runId: string;
  attemptId: string;
  worktreePath: string;
}
const WORKSPACE_COPY_EXCLUDES = new Set([".git", ".kiwi", "node_modules", "dist", ".turbo", ".cache"]);

function shouldExcludeWorkspaceEntry(entryName: string): boolean {
  return WORKSPACE_COPY_EXCLUDES.has(entryName);
}

function copyWorkspaceIntoWorktree(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (shouldExcludeWorkspaceEntry(entry.name)) continue;

    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyWorkspaceIntoWorktree(sourcePath, targetPath);
      continue;
    }
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile()) {
      mkdirSync(path.dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function linkNodeModulesIfPresent(source: string, target: string): void {
  const sourceNodeModules = path.join(source, "node_modules");
  const targetNodeModules = path.join(target, "node_modules");
  if (!existsSync(sourceNodeModules) || existsSync(targetNodeModules)) return;
  try {
    symlinkSync(sourceNodeModules, targetNodeModules, "dir");
  } catch {
    // Best-effort local validation convenience.
  }
}

function isGitRepository(sourcePath: string): boolean {
  return existsSync(path.join(sourcePath, ".git"));
}

function tryGitWorktreeAdd(sourcePath: string, worktreePath: string): boolean {
  try {
    execFileSync("git", ["-C", sourcePath, "worktree", "add", "--detach", worktreePath], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function tryGitWorktreeRemove(sourcePath: string, worktreePath: string): boolean {
  try {
    execFileSync("git", ["-C", sourcePath, "worktree", "remove", "--force", worktreePath], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export interface CreateWorktreeSandboxOptions {
  cwd: string;
  runId: string;
  attemptId: string;
  sourcePath?: string;
  copyWorkspace?: boolean;
  preferGitWorktree?: boolean;
}

export interface WorktreeSandboxResult extends WorktreeSandbox {
  isolation: "git-worktree" | "copy-folder";
  sourcePath: string;
}

export function createWorktreeSandbox(params: CreateWorktreeSandboxOptions): WorktreeSandboxResult {
  const sourcePath = params.sourcePath ?? params.cwd;
  const worktreePath = resolveRunArtifactPath(params.cwd, params.runId, `worktrees/${params.attemptId}`);
  const preferGit = params.preferGitWorktree ?? true;

  if (preferGit && isGitRepository(sourcePath)) {
    if (existsSync(worktreePath)) {
      try {
        rmSync(worktreePath, { recursive: true, force: true });
      } catch {
        // best effort; git worktree add will fail if path exists with content
      }
    }
    if (tryGitWorktreeAdd(sourcePath, worktreePath)) {
      appendAuditEvent(params.cwd, {
        eventType: "worktree_created",
        runId: params.runId,
        timestamp: new Date().toISOString(),
        payload: {
          attemptId: params.attemptId,
          worktreePath,
          isolation: "git-worktree",
          sourcePath,
        },
      });
      return {
        runId: params.runId,
        attemptId: params.attemptId,
        worktreePath,
        isolation: "git-worktree",
        sourcePath,
      };
    }
  }

  // Fallback: copy-folder isolation
  mkdirSync(worktreePath, { recursive: true });
  if (params.copyWorkspace ?? true) {
    copyWorkspaceIntoWorktree(sourcePath, worktreePath);
    linkNodeModulesIfPresent(sourcePath, worktreePath);
  }
  appendAuditEvent(params.cwd, {
    eventType: "worktree_created",
    runId: params.runId,
    timestamp: new Date().toISOString(),
    payload: {
      attemptId: params.attemptId,
      worktreePath,
      isolation: "copy-folder",
      sourcePath,
    },
  });
  return {
    runId: params.runId,
    attemptId: params.attemptId,
    worktreePath,
    isolation: "copy-folder",
    sourcePath,
  };
}

export function teardownWorktreeSandbox(params: {
  cwd: string;
  runId: string;
  attemptId: string;
  sourcePath: string;
  isolation: "git-worktree" | "copy-folder";
  worktreePath: string;
}): { removed: boolean } {
  let removed = false;
  if (params.isolation === "git-worktree" && isGitRepository(params.sourcePath)) {
    removed = tryGitWorktreeRemove(params.sourcePath, params.worktreePath);
  }
  if (existsSync(params.worktreePath)) {
    try {
      rmSync(params.worktreePath, { recursive: true, force: true });
      removed = true;
    } catch {
      // best effort
    }
  }
  if (removed) {
    appendAuditEvent(params.cwd, {
      eventType: "worktree_removed",
      runId: params.runId,
      timestamp: new Date().toISOString(),
      payload: {
        attemptId: params.attemptId,
        worktreePath: params.worktreePath,
        isolation: params.isolation,
      },
    });
  } else {
    appendAuditEvent(params.cwd, {
      eventType: "worktree_remove_failed",
      runId: params.runId,
      timestamp: new Date().toISOString(),
      payload: {
        attemptId: params.attemptId,
        worktreePath: params.worktreePath,
        isolation: params.isolation,
      },
    });
  }
  return { removed };
}

export interface OrphanReaperOptions {
  cwd: string;
  knownAttemptIds?: string[];
  sourcePath?: string;
}

function orphanWorktreeCandidate(params: {
  attemptDir: { name: string; isDirectory(): boolean };
  worktreesBase: string;
  known: Set<string>;
}): string | null {
  if (!params.attemptDir.isDirectory()) return null;
  if (params.known.has(params.attemptDir.name)) return null;
  const candidate = path.join(params.worktreesBase, params.attemptDir.name);
  return statSync(candidate).isDirectory() ? candidate : null;
}

function reapOrphanCandidate(params: {
  cwd: string;
  runId: string;
  attemptId: string;
  candidate: string;
  sourcePath?: string;
}): boolean {
  const gitFile = path.join(params.candidate, ".git");
  if (existsSync(gitFile) && params.sourcePath && isGitRepository(params.sourcePath)) {
    tryGitWorktreeRemove(params.sourcePath, params.candidate);
  }
  try {
    rmSync(params.candidate, { recursive: true, force: true });
    appendAuditEvent(params.cwd, {
      eventType: "worktree_orphan_reaped",
      runId: params.runId,
      timestamp: new Date().toISOString(),
      payload: { attemptId: params.attemptId, worktreePath: params.candidate },
    });
    return true;
  } catch {
    return false;
  }
}

export function reapOrphanWorktrees(options: OrphanReaperOptions): { reaped: string[] } {
  const runsBase = path.resolve(options.cwd, ".kiwi", "runs");
  if (!existsSync(runsBase)) return { reaped: [] };
  const reaped: string[] = [];
  const known = new Set(options.knownAttemptIds ?? []);
  for (const runDir of readdirSync(runsBase, { withFileTypes: true })) {
    if (!runDir.isDirectory()) continue;
    const worktreesBase = path.join(runsBase, runDir.name, "worktrees");
    if (!existsSync(worktreesBase)) continue;
    for (const attemptDir of readdirSync(worktreesBase, { withFileTypes: true })) {
      const candidate = orphanWorktreeCandidate({ attemptDir, worktreesBase, known });
      if (!candidate) continue;
      const removed = reapOrphanCandidate({
        cwd: options.cwd,
        runId: runDir.name,
        attemptId: attemptDir.name,
        candidate,
        ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
      });
      if (removed) {
        reaped.push(candidate);
      }
    }
  }
  return { reaped };
}
