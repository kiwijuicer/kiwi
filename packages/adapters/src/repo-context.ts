import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { Initiative } from "@kiwi/contracts";

const DEFAULT_MAX_CHARS = 12_000;
const HEAD_LINE_LIMIT = 100;
const HEAD_CHAR_LIMIT = 8_000;
const FILE_LIST_LIMIT = 400;
const GREP_HIT_LIMIT = 25;
const IGNORED_NAMES = new Set([".git", ".kiwi", "node_modules", "dist", "build", "coverage", ".turbo"]);
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "eine",
  "einer",
  "eines",
  "und",
  "oder",
  "der",
  "die",
  "das",
  "als",
  "mit",
  "fuer",
  "für",
]);

export interface RepoContextGrepHit {
  path: string;
  line: number;
  preview: string;
}

export interface RepoContextEnvelope {
  repoPath: string;
  status: "ok" | "missing" | "not_directory" | "unreadable";
  maxChars: number;
  readmeHead?: string | null;
  agentsHead?: string | null;
  grepKeywords: string[];
  grepHits: RepoContextGrepHit[];
  filePaths: string[];
  recentCommits: string[];
  localDiffPaths: string[];
  omittedFields: string[];
}

export function renderRepoContext(context: RepoContextEnvelope): string {
  return JSON.stringify(context, null, 2);
}

function runGit(repoPath: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf-8",
      maxBuffer: 512 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function readHead(repoPath: string, fileName: string): string | null {
  const target = path.join(repoPath, fileName);
  if (!existsSync(target)) return null;
  try {
    const stats = statSync(target);
    if (!stats.isFile()) return null;
    return readFileSync(target, "utf-8").split(/\r?\n/).slice(0, HEAD_LINE_LIMIT).join("\n").slice(0, HEAD_CHAR_LIMIT);
  } catch {
    return null;
  }
}

function listFilePaths(repoPath: string): string[] {
  const entries: string[] = [];
  const visit = (directory: string, depth: number): void => {
    if (depth > 3 || entries.length >= FILE_LIST_LIMIT) return;
    const children = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (IGNORED_NAMES.has(child.name)) continue;
      const absolute = path.join(directory, child.name);
      const relative = path.relative(repoPath, absolute);
      entries.push(child.isDirectory() ? `${relative}/` : relative);
      if (child.isDirectory()) visit(absolute, depth + 1);
      if (entries.length >= FILE_LIST_LIMIT) return;
    }
  };
  visit(repoPath, 1);
  return entries;
}

function extractKeywords(initiative: Pick<Initiative, "title" | "rawInput">): string[] {
  const text = `${initiative.title}\n${initiative.rawInput}`.toLowerCase();
  const tokens = text.match(/[\p{L}\p{N}_-]{3,}/gu) ?? [];
  return Array.from(new Set(tokens.filter((token) => !STOP_WORDS.has(token)))).slice(0, 12);
}

function grepHits(repoPath: string, keywords: string[]): RepoContextGrepHit[] {
  if (keywords.length === 0) return [];
  const args = ["grep", "-n", "-I", "--no-color", ...keywords.flatMap((keyword) => ["-e", keyword]), "--"];
  const output = runGit(repoPath, args);
  const hits: RepoContextGrepHit[] = [];
  const seenPaths = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!match?.[1] || !match[2]) continue;
    if (seenPaths.has(match[1])) continue;
    seenPaths.add(match[1]);
    hits.push({
      path: match[1],
      line: Number.parseInt(match[2], 10),
      preview: (match[3] ?? "").trim().slice(0, 240),
    });
    if (hits.length >= GREP_HIT_LIMIT) break;
  }
  return hits;
}

function compactToLimit(context: RepoContextEnvelope): RepoContextEnvelope {
  const compacted: RepoContextEnvelope = { ...context, omittedFields: [...context.omittedFields] };
  const exceeds = () => renderRepoContext(compacted).length > compacted.maxChars;
  if (exceeds() && compacted.filePaths.length > 0) {
    compacted.filePaths = [];
    compacted.omittedFields.push("filePaths");
  }
  if (exceeds() && compacted.grepHits.length > 0) {
    compacted.grepHits = [];
    compacted.omittedFields.push("grepHits");
  }
  if (exceeds() && (compacted.readmeHead || compacted.agentsHead)) {
    compacted.readmeHead = null;
    compacted.agentsHead = null;
    compacted.omittedFields.push("readmeHead", "agentsHead");
  }
  return compacted;
}

export function buildRepoContextEnvelope(params: {
  initiative: Pick<Initiative, "title" | "rawInput" | "repoPath">;
  maxChars?: number;
}): RepoContextEnvelope {
  const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS;
  const repoPath = params.initiative.repoPath;
  if (!existsSync(repoPath)) {
    return {
      repoPath,
      status: "missing",
      maxChars,
      grepKeywords: [],
      grepHits: [],
      filePaths: [],
      recentCommits: [],
      localDiffPaths: [],
      omittedFields: [],
    };
  }
  if (!statSync(repoPath).isDirectory()) {
    return {
      repoPath,
      status: "not_directory",
      maxChars,
      grepKeywords: [],
      grepHits: [],
      filePaths: [],
      recentCommits: [],
      localDiffPaths: [],
      omittedFields: [],
    };
  }

  try {
    const grepKeywords = extractKeywords(params.initiative);
    return compactToLimit({
      repoPath,
      status: "ok",
      maxChars,
      readmeHead: readHead(repoPath, "README.md"),
      agentsHead: readHead(repoPath, "AGENTS.md"),
      grepKeywords,
      grepHits: grepHits(repoPath, grepKeywords),
      filePaths: listFilePaths(repoPath),
      recentCommits: runGit(repoPath, ["log", "-5", "--pretty=%s"])
        .split(/\r?\n/)
        .filter(Boolean),
      localDiffPaths: runGit(repoPath, ["diff", "--name-only", "HEAD"])
        .split(/\r?\n/)
        .filter(Boolean)
        .sort(),
      omittedFields: [],
    });
  } catch (error) {
    return {
      repoPath,
      status: "unreadable",
      maxChars,
      grepKeywords: [],
      grepHits: [],
      filePaths: [],
      recentCommits: [],
      localDiffPaths: [],
      omittedFields: [error instanceof Error ? error.message : String(error)],
    };
  }
}
