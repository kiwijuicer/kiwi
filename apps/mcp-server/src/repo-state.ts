import { execFileSync } from "child_process";
import { createHash } from "crypto";

export interface McpRepoState {
  repoPath: string;
  isGitRepo: boolean;
  head: string | null;
  branch: string | null;
  protectedBranch: boolean;
  dirtyFiles: number;
  untrackedFiles: number;
  dirtyStateHash: string;
  warnings: string[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(repoPath: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function readRepoState(repoPath: string): McpRepoState {
  const gitRoot = git(repoPath, ["rev-parse", "--show-toplevel"]);
  if (!gitRoot) {
    return {
      repoPath,
      isGitRepo: false,
      head: null,
      branch: null,
      protectedBranch: false,
      dirtyFiles: 0,
      untrackedFiles: 0,
      dirtyStateHash: sha256("not-git"),
      warnings: ["repo is not a git worktree; preview token cannot bind to HEAD or dirty state"],
    };
  }

  const head = git(repoPath, ["rev-parse", "HEAD"]);
  const branch = git(repoPath, ["branch", "--show-current"]) || null;
  const status = git(repoPath, ["status", "--porcelain=v1", "--untracked-files=all"]) ?? "";
  const entries = status.split("\n").filter((line) => line.trim().length > 0);
  const untrackedFiles = entries.filter((line) => line.startsWith("??")).length;
  const protectedBranch = branch === "main" || branch === "master";
  const warnings: string[] = [];
  if (protectedBranch) warnings.push(`current branch is protected-looking: ${branch}`);
  if (entries.length > 0) warnings.push(`repo has ${entries.length} dirty/untracked file(s)`);

  return {
    repoPath,
    isGitRepo: true,
    head,
    branch,
    protectedBranch,
    dirtyFiles: entries.length,
    untrackedFiles,
    dirtyStateHash: sha256(entries.join("\n")),
    warnings,
  };
}
