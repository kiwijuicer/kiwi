import { execFile, execFileSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
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
  if (!existsSync(path.join(params.worktreePath, ".git"))) return null;
  let diff = "";
  try {
    const { stdout } = await execFileAsync("git", ["-C", params.worktreePath, "diff", "--no-color"]);
    diff = stdout;
  } catch {
    return null;
  }
  if (!diff.trim()) return null;
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

function captureGitDiffSync(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  worktreePath: string;
}): Artifact | null {
  if (!existsSync(path.join(params.worktreePath, ".git"))) return null;
  let diff = "";
  try {
    diff = execFileSync("git", ["-C", params.worktreePath, "diff", "--no-color"], {
      encoding: "utf-8",
    });
  } catch {
    return null;
  }
  if (!diff.trim()) return null;
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

export function captureDiffArtifact(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  worktreePath: string;
  sourcePath?: string;
}): Artifact | null {
  if (existsSync(path.join(params.worktreePath, ".git"))) {
    const gitArtifact = captureGitDiffSync(params);
    if (gitArtifact) return gitArtifact;
    return null;
  }
  const fallbackInput: Parameters<typeof captureWorktreeDiffArtifact>[0] = {
    cwd: params.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    worktreePath: params.worktreePath,
  };
  if (params.sourcePath) fallbackInput.sourcePath = params.sourcePath;
  return captureWorktreeDiffArtifact(fallbackInput);
}

function listComparableFiles(root: string, base: string = root): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (shouldExcludeWorkspaceEntry(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    const relative = path.relative(base, fullPath).replaceAll(path.sep, "/");
    if (entry.isDirectory()) {
      files.push(...listComparableFiles(fullPath, base));
      continue;
    }
    if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

function readTextIfReasonable(target: string): string {
  if (!existsSync(target)) return "";
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.size > 512_000) return "[binary-or-large-file]\n";
  const raw = readFileSync(target);
  if (raw.includes(0)) return "[binary-file]\n";
  return raw.toString("utf-8");
}

function simplePatchForFile(params: { relativePath: string; before: string; after: string }): string {
  if (params.before === params.after) return "";
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

  if (patch.trim().length === 0) return null;

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
