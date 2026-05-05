import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "fs";
import path from "path";
import {
  ContractValues,
  PrDraftArtifact,
  PrDraftArtifactSchema,
  ScmRepositoryRef,
  ScmRepositoryRefSchema,
} from "@kiwi/contracts";
import { appendAuditEvent } from "./cost-ledger";
import { writeEvidenceManifest } from "./evidence";
import { finalizeRun } from "./lifecycle";
import { loadAttemptDiff } from "./review-engine";
import { ensureRunLayout, loadInitiative, loadRunManifest, loadTaskGraph, resolveRunArtifactPath } from "./run-store";

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

function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

function branchFromRunId(runId: string): string {
  return `kiwi/${runId.replace(/[^a-zA-Z0-9._/-]/g, "-")}`;
}

function git(args: string[], cwd: string, runner: GitCommandRunner): string {
  return runner(args, cwd).stdout.trim();
}

function ensureCleanWorkingTree(repoPath: string, runner: GitCommandRunner): void {
  const status = git(["status", "--porcelain", "--untracked-files=no"], repoPath, runner);
  if (status.length > 0) {
    throw new Error("target repo has uncommitted changes; publish PR draft requires a clean working tree");
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

function parseBitbucketRemote(remoteUrl: string): ScmRepositoryRef {
  const trimmed = remoteUrl.trim().replace(/\.git$/, "");
  const ssh = trimmed.match(/^git@bitbucket\.org:([^/]+)\/(.+)$/);
  const https = trimmed.match(/^https:\/\/(?:[^@/]+@)?bitbucket\.org\/([^/]+)\/(.+)$/);
  const match = ssh ?? https;
  if (!match?.[1] || !match[2]) {
    throw new Error(`remote is not a Bitbucket Cloud URL: ${remoteUrl}`);
  }
  return ScmRepositoryRefSchema.parse({
    provider: ContractValues.BitbucketCloud,
    workspace: match[1],
    repoSlug: match[2],
    remoteUrl,
  });
}

function bitbucketCreatePrUrl(params: {
  repository: ScmRepositoryRef;
  sourceBranch: string;
  targetBranch: string;
}): string {
  const workspace = encodeURIComponent(params.repository.workspace!);
  const repoSlug = encodeURIComponent(params.repository.repoSlug!);
  const source = encodeURIComponent(params.sourceBranch);
  const dest = encodeURIComponent(params.targetBranch);
  return `https://bitbucket.org/${workspace}/${repoSlug}/pull-requests/new?source=${source}&dest=${dest}`;
}

function latestDiffs(params: { cwd: string; runId: string }): Array<{ path: string; hash: string }> {
  const taskGraph = loadTaskGraph(params.runId, params.cwd);
  const diffs: Array<{ path: string; hash: string }> = [];
  for (const step of taskGraph.steps) {
    const stepDir = resolveRunArtifactPath(params.runId, `steps/${step.stepId}`, params.cwd);
    if (!existsSync(stepDir)) continue;
    const attemptDirs = readdirSync(stepDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const attemptId = attemptDirs.at(-1);
    if (!attemptId) continue;
    const diff = loadAttemptDiff({ cwd: params.cwd, runId: params.runId, stepId: step.stepId, attemptId });
    if (diff)
      diffs.push({ path: resolveRunArtifactPath(params.runId, diff.diffPath, params.cwd), hash: diff.diffHash });
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
  git(["add", "--all"], repoPath, runner);
  if (!hasStagedChanges(repoPath, runner)) {
    throw new Error("diff artifacts did not produce staged changes");
  }
  git(["commit", "-m", `kiwi: ${initiative.title}`], repoPath, runner);
  git(["push", "-u", remote, branchName], repoPath, runner);

  const remoteUrl = git(["remote", "get-url", remote], repoPath, runner);
  const repository = parseBitbucketRemote(remoteUrl);
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
    createUrl: bitbucketCreatePrUrl({ repository, sourceBranch: branchName, targetBranch }),
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
