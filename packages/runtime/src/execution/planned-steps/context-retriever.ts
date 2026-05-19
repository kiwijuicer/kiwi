import { execFileSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { GateTypes, type Initiative, type Step } from "@kiwi/contracts";

export interface RetrievedContextFile {
  path: string;
  reason: string;
}

export interface ExecutionContextRetrieval {
  relevantFiles: string[];
  testFiles: string[];
  recentDiffFiles: string[];
  symbolHits: string[];
  traces: string[];
  architectureFiles: string[];
  retrievalFiles: RetrievedContextFile[];
}

interface ExecutionContextRetrieverOptions {
  maxRelevantFiles?: number;
  maxTestFiles?: number;
  maxTokens?: number;
}

const IGNORED_SEGMENTS = new Set([".git", ".kiwi", "node_modules", "dist"]);
export const CONTEXT_RETRIEVAL_STRATEGY_VERSION = "deterministic-rg-v1";

function isIgnored(filePath: string): boolean {
  return filePath.split("/").some((segment) => IGNORED_SEGMENTS.has(segment));
}

function cleanRelativePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalized || normalized.startsWith("../") || normalized.includes("/../") || isIgnored(normalized)) {
    return null;
  }

  return normalized;
}

function existingRelative(repoPath: string, filePath: string): string | null {
  const relative = cleanRelativePath(filePath);

  if (!relative) {
    return null;
  }

  return existsSync(path.join(repoPath, relative)) ? relative : null;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export class ExecutionContextRetriever {
  private readonly maxRelevantFiles: number;
  private readonly maxTestFiles: number;
  private readonly maxTokens: number;

  constructor(options: ExecutionContextRetrieverOptions = {}) {
    this.maxRelevantFiles = options.maxRelevantFiles ?? 24;
    this.maxTestFiles = options.maxTestFiles ?? 12;
    this.maxTokens = options.maxTokens ?? 8;
  }

  retrieve(params: { repoPath: string; initiative: Initiative; step: Step }): ExecutionContextRetrieval {
    const text = `${params.initiative.rawInput}\n${params.step.title}\n${params.step.successCriteria.join("\n")}`;
    const mentioned = this.filesMentionedIn(text)
      .map((file) => existingRelative(params.repoPath, file))
      .filter((entry): entry is string => entry !== null);
    const changed = this.gitChangedFiles(params.repoPath);
    const tokens = this.tokensFrom(text);
    const rgMatches = this.rgMatches(params.repoPath, tokens);
    const architectureFiles = this.architectureFilesFor(params.repoPath);
    const relevantFiles = unique([...mentioned, ...changed, ...rgMatches]).slice(0, this.maxRelevantFiles);
    const testFiles = this.testFilesFor(params.repoPath, relevantFiles);
    const retrievalFiles = this.retrievalFiles({
      mentioned,
      changed,
      rgMatches,
      testFiles,
      architectureFiles,
    });

    return {
      relevantFiles,
      testFiles,
      recentDiffFiles: changed,
      symbolHits: tokens,
      traces: [`context_retrieval:${CONTEXT_RETRIEVAL_STRATEGY_VERSION}`],
      architectureFiles,
      retrievalFiles,
    };
  }

  private retrievalFiles(params: {
    mentioned: string[];
    changed: string[];
    rgMatches: string[];
    testFiles: string[];
    architectureFiles: string[];
  }): RetrievedContextFile[] {
    const reasons = new Map<string, string>();
    const add = (files: string[], reason: string): void => {
      for (const file of files) {
        if (!reasons.has(file)) {
          reasons.set(file, reason);
        }
      }
    };

    add(params.mentioned, "mentioned");
    add(params.changed, "git-diff");
    add(params.rgMatches, "rg-match");
    add(params.testFiles, "test-neighbor");
    add(params.architectureFiles, "architecture");

    return [...reasons.entries()].map(([pathValue, reason]) => ({ path: pathValue, reason }));
  }

  private filesMentionedIn(text: string): string[] {
    return Array.from(text.matchAll(/(?:^|\s)([A-Za-z0-9_.@/-]+\.[A-Za-z0-9]+)(?=\s|$|[,.;:])/g))
      .map((match) => cleanRelativePath(match[1] ?? ""))
      .filter((entry): entry is string => Boolean(entry && !entry.startsWith("http")));
  }

  private tokensFrom(text: string): string[] {
    return unique(
      Array.from(text.matchAll(/[A-Za-z][A-Za-z0-9_-]{3,}/g))
        .map((match) => match[0])
        .filter((token) => !/^(this|that|with|from|into|update|implement|please|eine|einen|oder)$/i.test(token)),
    )
      .sort((a, b) => b.length - a.length || a.localeCompare(b))
      .slice(0, this.maxTokens);
  }

  private gitChangedFiles(repoPath: string): string[] {
    try {
      const output = execFileSync("git", ["-C", repoPath, "diff", "--name-only"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });

      return output
        .split("\n")
        .map((entry) => cleanRelativePath(entry.trim()))
        .filter((entry): entry is string => entry !== null)
        .slice(0, this.maxRelevantFiles);
    } catch {
      return [];
    }
  }

  private rgMatches(repoPath: string, tokens: string[]): string[] {
    const matches: string[] = [];

    for (const token of tokens) {
      try {
        const output = execFileSync(
          "rg",
          ["-l", "--fixed-strings", "--glob", "!node_modules/**", "--glob", "!dist/**", "--glob", "!.kiwi/**", token],
          {
            cwd: repoPath,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 10_000,
          },
        );
        matches.push(
          ...output
            .split("\n")
            .map((entry) => cleanRelativePath(entry.trim()))
            .filter((entry): entry is string => entry !== null),
        );
      } catch {
        continue;
      }
      if (matches.length >= this.maxRelevantFiles) {
        break;
      }
    }

    return unique(matches).slice(0, this.maxRelevantFiles);
  }

  private testFilesFor(repoPath: string, relevantFiles: string[]): string[] {
    const candidates = relevantFiles.flatMap((file) => {
      const withoutExt = file.replace(/\.[^.]+$/, "");
      const basename = path.basename(withoutExt);
      const dirname = path.dirname(withoutExt);

      return [
        `${withoutExt}.test.ts`,
        `${withoutExt}.spec.ts`,
        path.join(dirname, `${basename}.test.ts`).replace(/\\/g, "/"),
        path.join(GateTypes.Tests, `${basename}.test.ts`).replace(/\\/g, "/"),
      ];
    });

    return unique(candidates)
      .map((file) => existingRelative(repoPath, file))
      .filter((entry): entry is string => entry !== null)
      .slice(0, this.maxTestFiles);
  }

  private architectureFilesFor(repoPath: string): string[] {
    return [
      "AGENTS.md",
      "docs/vision.md",
      "docs/architecture.md",
      "docs/rules/project.md",
      "docs/rules/architecture.md",
      "docs/rules/testing.md",
    ].filter((file) => existsSync(path.join(repoPath, file)));
  }
}
