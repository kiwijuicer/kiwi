import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";

export interface ExecutionRepoState {
  repoPath: string;
  isGitRepo: boolean;
  head: string | null;
  branch: string | null;
  protectedBranch: boolean;
  dirtyFiles: number;
  trackedDirtyFiles: string[];
  untrackedFiles: number;
  untrackedFilePaths: string[];
  kiwiStateFiles: number;
  dirtyStateHash: string;
  warnings: string[];
}

export class DirectExecutionUnsafeError extends Error {
  readonly repoState: ExecutionRepoState;
  readonly reasons: string[];

  constructor(repoState: ExecutionRepoState, reasons: string[]) {
    super(`Direct execution is unsafe: ${reasons.join("; ")}`);
    this.name = "DirectExecutionUnsafeError";
    this.repoState = repoState;
    this.reasons = reasons;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(repoPath: string, args: string[], trim = true): string | null {
  try {
    const stdout = execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return trim ? stdout.trim() : stdout;
  } catch {
    return null;
  }
}

function statusPath(line: string): string {
  const raw = line.length >= 3 && line[2] === " " ? line.slice(3) : line.replace(/^[ MADRCU?!]{1,2}\s+/, "");
  const renamed = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
  return (renamed ?? raw).trim().replace(/^"|"$/g, "");
}

function isKiwiStatePath(filePath: string): boolean {
  return filePath === ".kiwi" || filePath.startsWith(".kiwi/");
}

function computeDirtyStateHash(repoPath: string, trackedDirtyFiles: string[], untrackedFilePaths: string[]): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ trackedDirtyFiles, untrackedFilePaths }));
  if (trackedDirtyFiles.length > 0) {
    hash.update(git(repoPath, ["diff", "--binary", "--", ...trackedDirtyFiles], false) ?? "");
    hash.update(git(repoPath, ["diff", "--cached", "--binary", "--", ...trackedDirtyFiles], false) ?? "");
  }
  for (const filePath of untrackedFilePaths) {
    const target = path.join(repoPath, filePath);
    if (!existsSync(target)) continue;
    const stat = statSync(target);
    if (!stat.isFile()) continue;
    hash.update(filePath);
    hash.update(readFileSync(target));
  }
  return hash.digest("hex");
}

export function readExecutionRepoState(repoPath: string): ExecutionRepoState {
  const gitRoot = git(repoPath, ["rev-parse", "--show-toplevel"]);
  if (!gitRoot) {
    return {
      repoPath,
      isGitRepo: false,
      head: null,
      branch: null,
      protectedBranch: false,
      dirtyFiles: 0,
      trackedDirtyFiles: [],
      untrackedFiles: 0,
      untrackedFilePaths: [],
      kiwiStateFiles: 0,
      dirtyStateHash: sha256("not-git"),
      warnings: ["repo is not a git worktree; preview token cannot bind to HEAD or dirty state"],
    };
  }

  const head = git(repoPath, ["rev-parse", "HEAD"]);
  const branch = git(repoPath, ["branch", "--show-current"]) || null;
  const status = git(repoPath, ["status", "--porcelain=v1", "--untracked-files=all"], false) ?? "";
  const entries = status.split("\n").filter((line) => line.trim().length > 0);
  const trackedDirtyFiles = entries
    .filter((line) => !line.startsWith("??"))
    .map(statusPath)
    .filter((filePath) => !isKiwiStatePath(filePath));
  const untrackedFilePaths = entries
    .filter((line) => line.startsWith("??"))
    .map(statusPath)
    .filter((filePath) => !isKiwiStatePath(filePath));
  const kiwiStateFiles = entries.map(statusPath).filter(isKiwiStatePath).length;
  const protectedBranch = branch === "main" || branch === "master";
  const warnings: string[] = [];
  if (protectedBranch) warnings.push(`current branch is protected-looking: ${branch}`);
  if (trackedDirtyFiles.length > 0) warnings.push(`repo has ${trackedDirtyFiles.length} tracked dirty file(s)`);
  if (untrackedFilePaths.length > 0) warnings.push(`repo has ${untrackedFilePaths.length} untracked non-kiwi file(s)`);

  return {
    repoPath,
    isGitRepo: true,
    head,
    branch,
    protectedBranch,
    dirtyFiles: trackedDirtyFiles.length + untrackedFilePaths.length,
    trackedDirtyFiles,
    untrackedFiles: untrackedFilePaths.length,
    untrackedFilePaths,
    kiwiStateFiles,
    dirtyStateHash: computeDirtyStateHash(repoPath, trackedDirtyFiles, untrackedFilePaths),
    warnings,
  };
}

export function directExecutionUnsafeReasons(repoState: ExecutionRepoState): string[] {
  const reasons: string[] = [];
  if (!repoState.isGitRepo) reasons.push("repo is not a git worktree");
  if (repoState.protectedBranch) reasons.push(`current branch is protected-looking: ${repoState.branch}`);
  if (repoState.trackedDirtyFiles.length > 0) {
    reasons.push(`tracked dirty files: ${repoState.trackedDirtyFiles.join(", ")}`);
  }
  if (repoState.untrackedFilePaths.length > 0) {
    reasons.push(`untracked non-kiwi files: ${repoState.untrackedFilePaths.join(", ")}`);
  }
  return reasons;
}

export function assertDirectExecutionSafe(repoPath: string): ExecutionRepoState {
  const repoState = readExecutionRepoState(repoPath);
  const reasons = directExecutionUnsafeReasons(repoState);
  if (reasons.length > 0) throw new DirectExecutionUnsafeError(repoState, reasons);
  return repoState;
}
