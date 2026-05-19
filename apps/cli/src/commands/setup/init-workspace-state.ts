import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import chalk from "chalk";
import {
  kiwiHomeModelRegistryPath,
  kiwiHomePolicyPath,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  loadKiwiConfig,
  resolveKiwiHome,
  saveKiwiConfig,
} from "@kiwi/core";
import {
  type ConfigWriteStatus,
  ConfigWriteStatuses,
  type GitignoreWriteStatus,
  GitignoreWriteStatuses,
} from "../../config/constants.js";
import {
  DEFAULT_MODEL_REGISTRY_YAML,
  DEFAULT_POLICY_YAML,
  defaultKiwiConfigYaml,
} from "../../config/default-config.js";
import { MCP_GITIGNORE_ENTRIES, type ConcreteMcpTarget } from "./init-mcp-config.js";

interface ConfigWriteResult {
  path: string;
  status: ConfigWriteStatus;
}

interface GitignoreWriteResult {
  path: string;
  status: GitignoreWriteStatus;
}

interface HomeDefaultsWriteResult {
  homePath: string;
  policy: ConfigWriteResult;
  registry: ConfigWriteResult;
}

interface WorkspaceStateWriteResult {
  targetCwd: string;
  kiwiDir: string;
  configPath: string;
  policyPath: string;
  registryPath: string;
  shouldWriteConfig: boolean;
  approverIdentity: ApproverIdentityWriteResult;
  homeDefaults: HomeDefaultsWriteResult;
  gitignore: GitignoreWriteResult;
}

const KIWI_GITIGNORE_ENTRY = ".kiwi/";
const ApproverIdentityWriteStatuses = {
  Written: "written",
  Updated: "updated",
  Preserved: "preserved",
  Unavailable: "unavailable",
} as const;

type ApproverIdentityWriteStatus = (typeof ApproverIdentityWriteStatuses)[keyof typeof ApproverIdentityWriteStatuses];

interface ApproverIdentityWriteResult {
  path: string;
  identity: string | null;
  status: ApproverIdentityWriteStatus;
}

export function logConfigWrite(result: ConfigWriteResult | null, displayPath: string): void {
  if (result?.status === ConfigWriteStatuses.Preserved) {
    console.log(chalk.gray("•") + ` ${displayPath} preserved`);
  }
  if (result?.status === ConfigWriteStatuses.Written) {
    console.log(chalk.green("✓") + ` ${displayPath} written`);
  }
  if (result?.status === ConfigWriteStatuses.Updated) {
    console.log(chalk.green("✓") + ` ${displayPath} updated`);
  }
}

export function displayPath(targetCwd: string, filePath: string): string {
  const relative = path.relative(targetCwd, filePath);

  return relative && !relative.startsWith("..") ? relative : filePath;
}

function writeFileIfMissingOrForced(target: string, contents: string, force: boolean): ConfigWriteResult {
  const existed = existsSync(target);

  if (existed && !force) {
    return { path: target, status: ConfigWriteStatuses.Preserved };
  }

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf-8");

  return { path: target, status: existed ? ConfigWriteStatuses.Updated : ConfigWriteStatuses.Written };
}

function readLocalGitConfig(targetCwd: string, key: string): string | null {
  try {
    const value = execFileSync("git", ["-C", targetCwd, "config", "--local", "--get", key], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function detectLocalGitApproverIdentity(targetCwd: string): string | null {
  const email = readLocalGitConfig(targetCwd, "user.email");

  if (!email) {
    return null;
  }
  const name = readLocalGitConfig(targetCwd, "user.name");

  return name ? `${name} <${email}>` : email;
}

function updateMissingApproverIdentity(configPath: string, identity: string | null): ApproverIdentityWriteResult {
  if (!identity) {
    return { path: configPath, identity: null, status: ApproverIdentityWriteStatuses.Unavailable };
  }
  const existing = loadKiwiConfig(configPath);
  const existingIdentity = existing.approver?.identity?.trim();

  if (existingIdentity) {
    return { path: configPath, identity: existingIdentity, status: ApproverIdentityWriteStatuses.Preserved };
  }
  const saved = saveKiwiConfig(configPath, {
    ...existing,
    approver: {
      ...existing.approver,
      identity,
    },
  });

  return {
    path: configPath,
    identity: saved.approver?.identity ?? identity,
    status: ApproverIdentityWriteStatuses.Updated,
  };
}

function writeHomeDefaults(env: Record<string, string | undefined>, force: boolean): HomeDefaultsWriteResult {
  const homePath = resolveKiwiHome(env);

  return {
    homePath,
    policy: writeFileIfMissingOrForced(kiwiHomePolicyPath(env), DEFAULT_POLICY_YAML, force),
    registry: writeFileIfMissingOrForced(kiwiHomeModelRegistryPath(env), DEFAULT_MODEL_REGISTRY_YAML, force),
  };
}

function normalizeGitignoreLine(line: string): string {
  return line.trim().replace(/^\//, "");
}

function kiwiHomeIgnoreEntries(targetCwd: string, homePath: string): string[] {
  const relative = path.relative(targetCwd, homePath);

  if (relative.length === 0) {
    throw new Error("KIWI_HOME must not point at the workspace root.");
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return [];
  }

  return [`${relative.split(path.sep).join("/")}/`];
}

function resolveGitInfoExcludePath(targetCwd: string): string | null {
  try {
    const output = execFileSync("git", ["-C", targetCwd, "rev-parse", "--git-path", "info/exclude"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return path.isAbsolute(output) ? output : path.join(targetCwd, output);
  } catch {
    return null;
  }
}

function resolveLocalIgnorePath(targetCwd: string): string {
  return resolveGitInfoExcludePath(targetCwd) ?? path.join(targetCwd, ".gitignore");
}

function writeGitignoreEntries(
  targetCwd: string,
  mcpTargets: Set<ConcreteMcpTarget>,
  extraEntries: string[] = [],
): GitignoreWriteResult {
  const gitignorePath = resolveLocalIgnorePath(targetCwd);
  const entries = [
    KIWI_GITIGNORE_ENTRY,
    ...extraEntries,
    ...[...mcpTargets].map((target) => MCP_GITIGNORE_ENTRIES[target]),
  ];

  if (!existsSync(gitignorePath)) {
    mkdirSync(path.dirname(gitignorePath), { recursive: true });
    writeFileSync(gitignorePath, `${entries.join("\n")}\n`, "utf-8");

    return { path: gitignorePath, status: GitignoreWriteStatuses.Updated };
  }

  const current = readFileSync(gitignorePath, "utf-8");
  const existing = new Set(
    current
      .split(/\r?\n/)
      .map(normalizeGitignoreLine)
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  const missing = entries.filter((entry) => !existing.has(normalizeGitignoreLine(entry)));

  if (missing.length === 0) {
    return { path: gitignorePath, status: GitignoreWriteStatuses.Preserved };
  }

  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  writeFileSync(gitignorePath, `${current}${separator}${missing.join("\n")}\n`, "utf-8");

  return { path: gitignorePath, status: GitignoreWriteStatuses.Updated };
}

export class GitignoreWriter {
  write(targetCwd: string, mcpTargets: Set<ConcreteMcpTarget>, extraEntries: string[] = []): GitignoreWriteResult {
    return writeGitignoreEntries(targetCwd, mcpTargets, extraEntries);
  }
}

export function writeWorkspaceState(params: {
  targetCwd: string;
  force: boolean;
  env: Record<string, string | undefined>;
  mcpTargets: Set<ConcreteMcpTarget>;
  gitignoreWriter: GitignoreWriter;
}): WorkspaceStateWriteResult {
  const kiwiDir = path.join(params.targetCwd, ".kiwi");
  const configPath = path.join(kiwiDir, "config.yaml");
  const policyPath = kiwiPolicyPath(params.targetCwd);
  const registryPath = kiwiModelRegistryPath(params.targetCwd);
  const homePath = resolveKiwiHome(params.env);
  const homeIgnoreEntries = kiwiHomeIgnoreEntries(params.targetCwd, homePath);
  const homeDefaults = writeHomeDefaults(params.env, params.force);
  const approverIdentity = detectLocalGitApproverIdentity(params.targetCwd);

  mkdirSync(path.join(kiwiDir, "runs"), { recursive: true });
  mkdirSync(path.join(kiwiDir, "logs"), { recursive: true });

  const shouldWriteConfig = !existsSync(configPath) || params.force;

  if (shouldWriteConfig) {
    writeFileSync(configPath, defaultKiwiConfigYaml(new Date().toISOString(), approverIdentity ?? undefined), "utf-8");
  }
  const approverIdentityResult = shouldWriteConfig
    ? {
        path: configPath,
        identity: approverIdentity,
        status: approverIdentity ? ApproverIdentityWriteStatuses.Written : ApproverIdentityWriteStatuses.Unavailable,
      }
    : updateMissingApproverIdentity(configPath, approverIdentity);

  return {
    targetCwd: params.targetCwd,
    kiwiDir,
    configPath,
    policyPath,
    registryPath,
    shouldWriteConfig,
    approverIdentity: approverIdentityResult,
    homeDefaults,
    gitignore: params.gitignoreWriter.write(params.targetCwd, params.mcpTargets, homeIgnoreEntries),
  };
}
