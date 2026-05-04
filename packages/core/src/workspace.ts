import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

export interface WorkspaceRepo {
  id: string;
  path: string;
}

export interface WorkspaceResolution {
  workspacePath: string;
  repos: WorkspaceRepo[];
  repo?: WorkspaceRepo;
}

export interface WorkspaceResolveInput {
  cwd?: string;
  workspacePath?: string;
  repo?: string;
  requireRepo?: boolean;
}

interface CodeWorkspaceFolder {
  name?: unknown;
  path?: unknown;
}

interface CodeWorkspaceFile {
  folders?: unknown;
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function normalizeRepoId(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .replace(/^-+|-+$/g, "")
    || "repo";
}

function codeWorkspaceFiles(root: string): string[] {
  if (!isDirectory(root)) return [];
  return readdirSync(root)
    .filter((entry) => entry.endsWith(".code-workspace"))
    .sort()
    .map((entry) => path.join(root, entry));
}

function parseCodeWorkspace(target: string): WorkspaceRepo[] {
  const parsed = JSON.parse(readFileSync(target, "utf-8")) as CodeWorkspaceFile;
  const folders = Array.isArray(parsed.folders) ? parsed.folders : [];
  const workspaceDir = path.dirname(target);
  return folders
    .map((entry): WorkspaceRepo | null => {
      const folder = entry as CodeWorkspaceFolder;
      if (typeof folder.path !== "string" || folder.path.trim().length === 0) return null;
      const repoPath = path.resolve(workspaceDir, folder.path);
      if (!isDirectory(repoPath)) return null;
      const idSource =
        typeof folder.name === "string" && folder.name.trim().length > 0
          ? folder.name
          : path.basename(repoPath);
      return {
        id: normalizeRepoId(idSource),
        path: repoPath,
      };
    })
    .filter((entry): entry is WorkspaceRepo => entry !== null);
}

function dedupeRepos(repos: WorkspaceRepo[]): WorkspaceRepo[] {
  const seenPaths = new Set<string>();
  const seenIds = new Map<string, number>();
  const result: WorkspaceRepo[] = [];
  for (const repo of repos) {
    const resolvedPath = path.resolve(repo.path);
    if (seenPaths.has(resolvedPath)) continue;
    seenPaths.add(resolvedPath);
    const count = seenIds.get(repo.id) ?? 0;
    seenIds.set(repo.id, count + 1);
    result.push({
      id: count === 0 ? repo.id : `${repo.id}-${count + 1}`,
      path: resolvedPath,
    });
  }
  return result;
}

export function discoverWorkspaceRepos(workspacePath: string): WorkspaceRepo[] {
  const root = path.resolve(workspacePath);
  const codeWorkspaceRepos = codeWorkspaceFiles(root).flatMap((target) => parseCodeWorkspace(target));
  if (codeWorkspaceRepos.length > 0) return dedupeRepos(codeWorkspaceRepos);
  return isDirectory(root)
    ? [
        {
          id: normalizeRepoId(path.basename(root)),
          path: root,
        },
      ]
    : [];
}

function findKnownWorkspaceRoot(cwd: string): string | null {
  let current = path.resolve(cwd);
  while (true) {
    if (codeWorkspaceFiles(current).length > 0) return current;
    if (existsSync(path.join(current, ".kiwi", "config.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function repoCandidatesMessage(repos: WorkspaceRepo[]): string {
  return repos.map((repo) => `${repo.id} (${repo.path})`).join(", ");
}

function resolveRepoSelector(selector: string, workspacePath: string, repos: WorkspaceRepo[]): WorkspaceRepo | null {
  const selectorPath = path.isAbsolute(selector)
    ? path.resolve(selector)
    : path.resolve(workspacePath, selector);
  const byId = repos.find((repo) => repo.id === selector);
  if (byId) return byId;
  const byPath = repos.find((repo) => path.resolve(repo.path) === selectorPath);
  if (byPath) return byPath;
  if (isDirectory(selectorPath)) {
    return {
      id: normalizeRepoId(path.basename(selectorPath)),
      path: selectorPath,
    };
  }
  return null;
}

function resolveCurrentRepo(cwd: string, repos: WorkspaceRepo[]): WorkspaceRepo | null {
  const matches = repos
    .filter((repo) => containsPath(repo.path, cwd))
    .sort((a, b) => b.path.length - a.path.length);
  return matches[0] ?? null;
}

export function resolveWorkspace(input: WorkspaceResolveInput = {}): WorkspaceResolution {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const workspacePath = input.workspacePath
    ? path.resolve(cwd, input.workspacePath)
    : (findKnownWorkspaceRoot(cwd) ?? cwd);

  if (!isDirectory(workspacePath)) {
    throw new Error(`Workspace path not found: ${workspacePath}`);
  }

  const repos = discoverWorkspaceRepos(workspacePath);
  const repo = input.repo
    ? resolveRepoSelector(input.repo, workspacePath, repos)
    : resolveCurrentRepo(cwd, repos) ?? (repos.length === 1 ? repos[0] : null);

  if (input.repo && !repo) {
    throw new Error(`Repo not found: ${input.repo}. Candidates: ${repoCandidatesMessage(repos)}`);
  }
  if (input.requireRepo && !repo) {
    throw new Error(`Repo is ambiguous. Use --repo with one of: ${repoCandidatesMessage(repos)}`);
  }

  const resolution: WorkspaceResolution = {
    workspacePath,
    repos,
  };
  if (repo) resolution.repo = repo;
  return resolution;
}
