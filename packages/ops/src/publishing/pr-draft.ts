import { execFileSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { PrDraftArtifact, PrDraftArtifactSchema } from "@kiwi/contracts";
import { bitbucketCloudCreatePrUrl, parseBitbucketCloudRemote } from "@kiwi/adapters";
import {
  appendAuditEvent,
  ensureRunLayout,
  loadInitiative,
  loadRunManifest,
  loadTaskGraph,
  resolveRunArtifactPath,
} from "@kiwi/core";
import { finalizeRun, loadAttemptDiff } from "@kiwi/runtime";
import { writeEvidenceManifest } from "../evidence";
import { writeJsonSafely } from "../storage/json-io";

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export type GitCommandRunner = (args: string[], cwd: string) => GitCommandResult;

export interface PublishPrDraftParams {
  cwd: string;
  runId: string;
  remote?: string;
  targetBranch?: string;
  branchName?: string;
  now?: Date;
  git?: GitCommandRunner;
}

export interface PublishPrDraftResult {
  prDraft: PrDraftArtifact;
  prDraftRef: string;
}

function defaultGit(args: string[], cwd: string): GitCommandResult {
  try {
    const stdout = execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });

    return { stdout, stderr: "" };
  } catch (error) {
    const typed = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stderr = Buffer.isBuffer(typed.stderr)
      ? typed.stderr.toString("utf-8")
      : typeof typed.stderr === "string"
        ? typed.stderr
        : (typed.message ?? "git command failed");
    const stdout = Buffer.isBuffer(typed.stdout) ? typed.stdout.toString("utf-8") : (typed.stdout ?? "");
    throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`);
  }
}

function branchFromRunId(runId: string): string {
  return `kiwi/${runId.replace(/[^a-zA-Z0-9._/-]/g, "-")}`;
}

function git(args: string[], cwd: string, runner: GitCommandRunner): string {
  return runner(args, cwd).stdout.trim();
}

function gitRaw(args: string[], cwd: string, runner: GitCommandRunner): string {
  return runner(args, cwd).stdout;
}

function statusPath(line: string): string {
  const raw = line.length >= 3 && line[2] === " " ? line.slice(3) : line.replace(/^[ MADRCU?!]{1,2}\s+/, "");
  const renamed = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;

  return (renamed ?? raw).trim().replace(/^"|"$/g, "");
}

function isKiwiStatePath(filePath: string): boolean {
  return filePath === ".kiwi" || filePath.startsWith(".kiwi/");
}

function changedRepoFiles(repoPath: string, runner: GitCommandRunner): string[] {
  return gitRaw(["status", "--porcelain", "--untracked-files=all"], repoPath, runner)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map(statusPath)
    .filter((filePath) => !isKiwiStatePath(filePath))
    .sort();
}

function ensureCleanWorkingTree(repoPath: string, runner: GitCommandRunner): void {
  const changed = changedRepoFiles(repoPath, runner);

  if (changed.length > 0) {
    throw new Error(
      `target repo has local changes; publish PR draft requires a clean working tree: ${changed.join(", ")}`,
    );
  }
}

function switchToPublishBranch(params: {
  repoPath: string;
  branchName: string;
  targetBranch: string;
  runner: GitCommandRunner;
}): void {
  const existingBranches = git(["branch", "--list", params.branchName], params.repoPath, params.runner);

  if (existingBranches.trim().length > 0) {
    git(["switch", params.branchName], params.repoPath, params.runner);

    return;
  }

  try {
    git(["rev-parse", "--verify", params.targetBranch], params.repoPath, params.runner);
    git(["switch", "-c", params.branchName, params.targetBranch], params.repoPath, params.runner);
  } catch {
    git(["switch", "-c", params.branchName], params.repoPath, params.runner);
  }
}

function diffTouchedFiles(diffText: string): string[] {
  const files = new Set<string>();

  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ b/")) {
      files.add(line.slice("+++ b/".length));
    }
    if (line.startsWith("--- a/")) {
      files.add(line.slice("--- a/".length));
    }
  }
  files.delete("/dev/null");

  return Array.from(files).sort();
}

function latestDiffs(params: { cwd: string; runId: string }): Array<{ path: string; hash: string; files: string[] }> {
  const taskGraph = loadTaskGraph(params.runId, params.cwd);
  const diffs: Array<{ path: string; hash: string; files: string[] }> = [];

  for (const step of taskGraph.steps) {
    const stepDir = resolveRunArtifactPath(params.runId, `steps/${step.stepId}`, params.cwd);

    if (!existsSync(stepDir)) {
      continue;
    }
    const attemptDirs = readdirSync(stepDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const attemptId = attemptDirs.at(-1);

    if (!attemptId) {
      continue;
    }
    const diff = loadAttemptDiff({ cwd: params.cwd, runId: params.runId, stepId: step.stepId, attemptId });

    if (diff) {
      diffs.push({
        path: resolveRunArtifactPath(params.runId, diff.diffPath, params.cwd),
        hash: diff.diffHash,
        files: diffTouchedFiles(diff.diff),
      });
    }
  }

  return diffs;
}

function applyDiffs(params: { repoPath: string; diffs: Array<{ path: string }>; runner: GitCommandRunner }): void {
  for (const diff of params.diffs) {
    git(["apply", "--check", diff.path], params.repoPath, params.runner);
  }
  for (const diff of params.diffs) {
    git(["apply", diff.path], params.repoPath, params.runner);
  }
}

function ensureOnlyExpectedFilesChanged(params: {
  repoPath: string;
  expectedFiles: string[];
  runner: GitCommandRunner;
}): void {
  const expected = new Set(params.expectedFiles);
  const changed = changedRepoFiles(params.repoPath, params.runner);
  const unexpected = changed.filter((file) => !expected.has(file));

  if (unexpected.length > 0) {
    throw new Error(`patch application changed unexpected files: ${unexpected.join(", ")}`);
  }
}

function hasStagedChanges(repoPath: string, runner: GitCommandRunner): boolean {
  try {
    git(["diff", "--cached", "--quiet"], repoPath, runner);

    return false;
  } catch {
    return true;
  }
}

export function publishPrDraft(params: PublishPrDraftParams): PublishPrDraftResult {
  const now = params.now ?? new Date();
  const remote = params.remote ?? "origin";
  const targetBranch = params.targetBranch ?? "main";
  const runner = params.git ?? defaultGit;
  ensureRunLayout(params.runId, params.cwd);

  const run = loadRunManifest(params.runId, params.cwd);
  const initiative = loadInitiative(params.runId, params.cwd);
  const repoPath = run.repoPath ?? initiative.repoPath;
  const verdict = finalizeRun({ cwd: params.cwd, runId: params.runId, now }).verdict;

  if (!verdict.safeToApply) {
    throw new Error(`cannot publish PR draft because run is not safe to apply: ${verdict.reason}`);
  }

  const diffs = latestDiffs({ cwd: params.cwd, runId: params.runId });

  if (diffs.length === 0) {
    throw new Error("cannot publish PR draft without a diff artifact");
  }

  ensureCleanWorkingTree(repoPath, runner);
  const branchName = params.branchName ?? branchFromRunId(params.runId);
  switchToPublishBranch({ repoPath, branchName, targetBranch, runner });
  applyDiffs({ repoPath, diffs, runner });
  const expectedFiles = Array.from(new Set(diffs.flatMap((diff) => diff.files))).sort();

  if (expectedFiles.length === 0) {
    throw new Error("cannot publish PR draft because diff artifacts contain no file paths");
  }
  ensureOnlyExpectedFilesChanged({ repoPath, expectedFiles, runner });
  git(["add", "--", ...expectedFiles], repoPath, runner);
  if (!hasStagedChanges(repoPath, runner)) {
    throw new Error("diff artifacts did not produce staged changes");
  }
  git(["commit", "-m", `kiwi: ${initiative.title}`], repoPath, runner);
  git(["push", "-u", remote, branchName], repoPath, runner);

  const remoteUrl = git(["remote", "get-url", remote], repoPath, runner);
  const repository = parseBitbucketCloudRemote(remoteUrl);
  const evidence = writeEvidenceManifest({ cwd: params.cwd, runId: params.runId, now });
  const diffHash = diffs.length === 1 ? diffs[0]?.hash : undefined;
  const prDraft = PrDraftArtifactSchema.parse({
    schemaVersion: "1",
    runId: params.runId,
    repository,
    remote,
    sourceBranch: branchName,
    targetBranch,
    title: initiative.title,
    description: [
      `Kiwi run: ${params.runId}`,
      "",
      `Evidence manifest: ${evidence.manifestRef}`,
      `Final verdict: final/final-verdict.json`,
      diffHash ? `Diff hash: ${diffHash}` : `Diff artifacts: ${diffs.length}`,
    ].join("\n"),
    createUrl: bitbucketCloudCreatePrUrl({ repository, sourceBranch: branchName, targetBranch }),
    evidenceRefs: [evidence.manifestRef, "final/final-verdict.json", "final/final-cost-report.json"],
    ...(diffHash ? { diffHash } : {}),
    pushedAt: now.toISOString(),
    createdAt: now.toISOString(),
  });
  const prDraftRef = "final/pr-draft.json";
  writeJsonSafely(resolveRunArtifactPath(params.runId, prDraftRef, params.cwd), prDraft);
  appendAuditEvent(params.cwd, {
    eventType: "pr_draft_published",
    runId: params.runId,
    timestamp: now.toISOString(),
    payload: {
      remote,
      sourceBranch: branchName,
      targetBranch,
      createUrl: prDraft.createUrl,
      prDraftRef,
    },
  });

  return { prDraft, prDraftRef };
}
