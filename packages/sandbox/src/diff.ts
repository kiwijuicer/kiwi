import { execFile, execFileSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { Artifact } from "@kiwi/contracts";
import { resolveRunArtifactPath } from "./common";

const execFileAsync = promisify(execFile);
const WORKSPACE_COPY_EXCLUDES = new Set([".git", ".kiwi", "node_modules", "dist", ".turbo", ".cache"]);

function shouldExcludeWorkspaceEntry(entryName: string): boolean {
  return WORKSPACE_COPY_EXCLUDES.has(entryName);
}

export async function captureGitDiffArtifact(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  worktreePath: string;
}): Promise<Artifact | null> {
  if (!existsSync(path.join(params.worktreePath, ".git"))) {
    return null;
  }
  let diff = "";

  try {
    diff = await captureGitDiffText(params.worktreePath);
  } catch {
    return null;
  }
  if (!diff.trim()) {
    return null;
  }
  const ref = `steps/${params.stepId}/${params.attemptId}/artifacts/diff.patch`;
  const target = resolveRunArtifactPath(params.cwd, params.runId, ref);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, diff, "utf-8");

  return {
    type: "diff",
    ref,
    createdAt: new Date().toISOString(),
  };
}

function gitEnvWithIndex(indexPath: string): NodeJS.ProcessEnv {
  return { ...process.env, GIT_INDEX_FILE: indexPath };
}

export function createGitTreeSnapshot(worktreePath: string): string | null {
  if (!existsSync(path.join(worktreePath, ".git"))) {
    return null;
  }
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "kiwi-git-index-"));
  const indexPath = path.join(tempDir, "index");

  try {
    const sourceIndexPath = execFileSync("git", ["-C", worktreePath, "rev-parse", "--git-path", "index"], {
      encoding: "utf-8",
    }).trim();

    if (existsSync(sourceIndexPath)) {
      copyFileSync(sourceIndexPath, indexPath);
    }
    const env = gitEnvWithIndex(indexPath);
    execFileSync("git", ["-C", worktreePath, "add", "-A", "--", "."], { env, stdio: "ignore" });

    return execFileSync("git", ["-C", worktreePath, "write-tree"], { env, encoding: "utf-8" }).trim();
  } catch {
    return null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function commandOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }
  const value = (error as { stdout?: unknown; stderr?: unknown })[key];

  if (Buffer.isBuffer(value)) {
    return value.toString("utf-8");
  }

  return typeof value === "string" ? value : "";
}

function execGitDiffWithExpectedDifference(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8" });
  } catch (error) {
    const stdout = commandOutput(error, "stdout");

    if (stdout.trim()) {
      return stdout;
    }
    throw error;
  }
}

function listUntrackedFiles(worktreePath: string): string[] {
  const output = execFileSync("git", ["-C", worktreePath, "ls-files", "--others", "--exclude-standard"], {
    encoding: "utf-8",
  });

  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !shouldExcludeDiffPath(entry));
}

function shouldExcludeDiffPath(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => shouldExcludeWorkspaceEntry(segment));
}

function untrackedFileDiff(worktreePath: string, relativePath: string): string {
  return execGitDiffWithExpectedDifference(
    ["diff", "--no-color", "--no-index", "--", "/dev/null", relativePath],
    worktreePath,
  );
}

async function captureGitDiffText(worktreePath: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", worktreePath, "diff", "--no-color", "--binary"]);
  const untrackedDiffs = listUntrackedFiles(worktreePath).map((relativePath) =>
    untrackedFileDiff(worktreePath, relativePath),
  );

  return [stdout, ...untrackedDiffs].filter((entry) => entry.trim().length > 0).join("\n");
}

function captureGitDiffTextSync(worktreePath: string): string {
  const tracked = execFileSync("git", ["-C", worktreePath, "diff", "--no-color", "--binary"], {
    encoding: "utf-8",
  });
  const untrackedDiffs = listUntrackedFiles(worktreePath).map((relativePath) =>
    untrackedFileDiff(worktreePath, relativePath),
  );

  return [tracked, ...untrackedDiffs].filter((entry) => entry.trim().length > 0).join("\n");
}

function captureGitDiffSync(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  worktreePath: string;
  baseTree?: string | null;
}): Artifact | null {
  if (!existsSync(path.join(params.worktreePath, ".git"))) {
    return null;
  }
  let diff = "";

  try {
    diff = params.baseTree
      ? captureGitDiffTextFromBaseTree(params.worktreePath, params.baseTree)
      : captureGitDiffTextSync(params.worktreePath);
  } catch {
    return null;
  }
  if (!diff.trim()) {
    return null;
  }
  const ref = `steps/${params.stepId}/${params.attemptId}/artifacts/diff.patch`;
  const target = resolveRunArtifactPath(params.cwd, params.runId, ref);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, diff, "utf-8");

  return {
    type: "diff",
    ref,
    createdAt: new Date().toISOString(),
  };
}

function captureGitDiffTextFromBaseTree(worktreePath: string, baseTree: string): string {
  const afterTree = createGitTreeSnapshot(worktreePath);

  if (!afterTree) {
    return "";
  }

  return execFileSync("git", ["-C", worktreePath, "diff", "--no-color", "--binary", baseTree, afterTree], {
    encoding: "utf-8",
  });
}

export function captureDiffArtifact(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  worktreePath: string;
  sourcePath?: string;
  baseTree?: string | null;
}): Artifact | null {
  if (existsSync(path.join(params.worktreePath, ".git"))) {
    const gitArtifact = captureGitDiffSync(params);

    if (gitArtifact) {
      return gitArtifact;
    }

    return null;
  }
  const fallbackInput: Parameters<typeof captureWorktreeDiffArtifact>[0] = {
    cwd: params.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    worktreePath: params.worktreePath,
  };

  if (params.sourcePath) {
    fallbackInput.sourcePath = params.sourcePath;
  }

  return captureWorktreeDiffArtifact(fallbackInput);
}

function listComparableFiles(root: string, base: string = root): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const files: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (shouldExcludeWorkspaceEntry(entry.name)) {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    const relative = path.relative(base, fullPath).replaceAll(path.sep, "/");

    if (entry.isDirectory()) {
      files.push(...listComparableFiles(fullPath, base));
      continue;
    }
    if (entry.isFile()) {
      files.push(relative);
    }
  }

  return files.sort();
}

function readTextIfReasonable(target: string): string {
  if (!existsSync(target)) {
    return "";
  }
  const stat = lstatSync(target);

  if (!stat.isFile() || stat.size > 512_000) {
    return "[binary-or-large-file]\n";
  }
  const raw = readFileSync(target);

  if (raw.includes(0)) {
    return "[binary-file]\n";
  }

  return raw.toString("utf-8");
}

function simplePatchForFile(params: { relativePath: string; before: string; after: string }): string {
  if (params.before === params.after) {
    return "";
  }
  const beforeLines = params.before
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => `-${line}`)
    .join("\n");
  const afterLines = params.after
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => `+${line}`)
    .join("\n");

  return [
    `diff --kiwi a/${params.relativePath} b/${params.relativePath}`,
    `--- a/${params.relativePath}`,
    `+++ b/${params.relativePath}`,
    "@@",
    beforeLines,
    afterLines,
    "",
  ].join("\n");
}

export function captureWorktreeDiffArtifact(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  worktreePath: string;
  sourcePath?: string;
}): Artifact | null {
  const sourcePath = params.sourcePath ?? params.cwd;
  const workspaceFiles = listComparableFiles(sourcePath);
  const worktreeFiles = listComparableFiles(params.worktreePath);
  const allFiles = Array.from(new Set([...workspaceFiles, ...worktreeFiles])).sort();
  const patch = allFiles
    .map((relativePath) =>
      simplePatchForFile({
        relativePath,
        before: readTextIfReasonable(path.join(sourcePath, relativePath)),
        after: readTextIfReasonable(path.join(params.worktreePath, relativePath)),
      }),
    )
    .filter((entry) => entry.length > 0)
    .join("\n");

  if (patch.trim().length === 0) {
    return null;
  }

  const createdAt = new Date().toISOString();
  const ref = `steps/${params.stepId}/${params.attemptId}/artifacts/diff.patch`;
  const target = resolveRunArtifactPath(params.cwd, params.runId, ref);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, patch, "utf-8");

  return {
    type: "diff",
    ref,
    createdAt,
  };
}

export function readCommandOutputArtifact(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
}): unknown {
  const target = resolveRunArtifactPath(
    params.cwd,
    params.runId,
    `steps/${params.stepId}/${params.attemptId}/artifacts/command-output.json`,
  );

  if (!existsSync(target)) {
    throw new Error("command output artifact not found");
  }

  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}

export interface ApplyDiffArtifactResult {
  applied: boolean;
  patchPath: string;
  reason?: string;
}

function gitApplyCheck(sourcePath: string, patchPath: string): void {
  execFileSync("git", ["-C", sourcePath, "apply", "--check", patchPath], { stdio: "pipe" });
}

function gitApply(sourcePath: string, patchPath: string): void {
  execFileSync("git", ["-C", sourcePath, "apply", patchPath], { stdio: "pipe" });
}

function gitApplyReverseCheck(sourcePath: string, patchPath: string): void {
  execFileSync("git", ["-C", sourcePath, "apply", "--reverse", "--check", patchPath], { stdio: "pipe" });
}

function gitApplyErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { stderr?: unknown; stdout?: unknown };
    const stderr = Buffer.isBuffer(maybe.stderr) ? maybe.stderr.toString("utf-8") : maybe.stderr;
    const stdout = Buffer.isBuffer(maybe.stdout) ? maybe.stdout.toString("utf-8") : maybe.stdout;
    const detail = [stderr, stdout]
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .join("\n");

    if (detail.trim()) {
      return detail.trim();
    }
  }

  return error instanceof Error ? error.message : String(error);
}

export function applyDiffArtifactToSource(params: {
  cwd: string;
  runId: string;
  diffRef: string;
  sourcePath: string;
}): ApplyDiffArtifactResult {
  const patchPath = resolveRunArtifactPath(params.cwd, params.runId, params.diffRef);

  if (!existsSync(patchPath)) {
    return { applied: false, patchPath, reason: `diff artifact not found: ${params.diffRef}` };
  }
  if (!existsSync(path.join(params.sourcePath, ".git"))) {
    return { applied: false, patchPath, reason: `source path is not a git repository: ${params.sourcePath}` };
  }
  try {
    gitApplyCheck(params.sourcePath, patchPath);
    gitApply(params.sourcePath, patchPath);

    return { applied: true, patchPath };
  } catch (error) {
    try {
      gitApplyReverseCheck(params.sourcePath, patchPath);

      return { applied: true, patchPath, reason: "diff already applied" };
    } catch {
      // Return the original apply error; the reverse check is only a retry/idempotency probe.
    }

    return { applied: false, patchPath, reason: gitApplyErrorMessage(error) };
  }
}
