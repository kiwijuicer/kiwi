import path from "path";
import { ApprovalStates, ContractValues, NetworkPolicies, RunnerExecutionStatuses } from "@kiwi/contracts";
import type { SandboxCommandInput } from "./types";
import { SandboxPolicyDecisionStatuses } from "../constants";

export type PolicyDecision =
  | { status: typeof SandboxPolicyDecisionStatuses.Allow; reason: string }
  | { status: typeof ContractValues.Blocked | typeof RunnerExecutionStatuses.ApprovalRequired; reason: string };

const NETWORK_COMMANDS = new Set(["curl", "wget", "ssh", "scp", "git", "npm", "pnpm", "yarn"]);
const MUTATING_GIT_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "merge",
  "mv",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
  "tag",
]);
const GIT_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--work-tree",
]);

function resolveWithinWorktree(worktreePath: string, candidate: string): string {
  const base = path.resolve(worktreePath);
  const target = path.resolve(base, candidate);

  if (!(target === base || target.startsWith(`${base}${path.sep}`))) {
    throw new Error(`path escapes worktree: ${candidate}`);
  }

  return target;
}

function normalizePathForMatch(worktreePath: string, candidate: string): string {
  const base = path.resolve(worktreePath);
  const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : resolveWithinWorktree(base, candidate);

  return path.relative(base, resolved).replaceAll(path.sep, "/");
}

function wildcardPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");

  return new RegExp(`^${escaped}$`);
}

function matchesPathPattern(pathValue: string, pattern: string): boolean {
  return wildcardPatternToRegExp(pattern.replaceAll(path.sep, "/")).test(pathValue);
}

function commandTouchesPath(command: string[], worktreePath: string, patterns: string[]): boolean {
  return command.some((arg) => {
    if (!arg.includes("/") && !arg.startsWith(".")) {
      return false;
    }
    const normalized = normalizePathForMatch(worktreePath, arg);

    return patterns.some((pattern) => matchesPathPattern(normalized, pattern));
  });
}

function commandAllowed(command: string[], allowedCommands: string[]): boolean {
  const executable = command[0];

  if (!executable) {
    return false;
  }
  const commandText = command.join(" ");

  return allowedCommands.some((allowed) => executable === allowed || commandText.startsWith(`${allowed} `));
}

function usesNetwork(command: string[]): boolean {
  const executable = path.basename(command[0] ?? "");

  if (executable === "git") {
    const subcommand = command[1] ?? "";

    return ["clone", "fetch", "pull", "push", "submodule"].includes(subcommand);
  }
  if (["npm", "pnpm", "yarn"].includes(executable)) {
    const subcommand = command[1] ?? "";

    return ["add", "install", "update", "upgrade", "dlx", "create"].includes(subcommand);
  }
  if (NETWORK_COMMANDS.has(executable)) {
    return true;
  }

  return command.some((arg) => /^https?:\/\//i.test(arg));
}

function gitSubcommand(command: string[], gitIndex: number): string | null {
  let skipNext = false;

  for (const token of command.slice(gitIndex + 1)) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (GIT_OPTIONS_WITH_VALUE.has(token)) {
      skipNext = true;
      continue;
    }
    if (token.startsWith("--") && token.includes("=")) {
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }

    return token;
  }

  return null;
}

function requiresExplicitGitMutationApproval(command: string[]): boolean {
  return command.some((token, index) => {
    if (path.basename(token) !== "git") {
      return false;
    }
    const subcommand = gitSubcommand(command, index);

    return subcommand !== null && MUTATING_GIT_SUBCOMMANDS.has(subcommand);
  });
}

function blocked(reason: string): PolicyDecision {
  return { status: ContractValues.Blocked, reason };
}

function approvalRequired(reason: string): PolicyDecision {
  return { status: RunnerExecutionStatuses.ApprovalRequired, reason };
}

export function evaluatePolicy(input: SandboxCommandInput): PolicyDecision {
  const checks: Array<() => PolicyDecision | null> = [
    () => (input.command.length === 0 ? blocked("empty command") : null),
    () => (input.policy.approvalState === ApprovalStates.Blocked ? blocked("command approval state is blocked") : null),
    () =>
      requiresExplicitGitMutationApproval(input.command) && !input.approved
        ? approvalRequired("git state changes require explicit approval")
        : null,
    () => (!commandAllowed(input.command, input.policy.allowedCommands) ? blocked("command is not allowlisted") : null),
    () =>
      input.policy.networkPolicy === NetworkPolicies.Disabled && usesNetwork(input.command)
        ? blocked("network access is disabled for this attempt")
        : null,
    () =>
      commandTouchesPath(input.command, input.worktreePath, input.policy.deniedPaths)
        ? blocked("command touches a denied path")
        : null,
    () =>
      (input.policy.approvalState === ApprovalStates.Required ||
        commandTouchesPath(input.command, input.worktreePath, input.policy.approvalRequiredPaths)) &&
      !input.approved
        ? approvalRequired("explicit approval is required")
        : null,
  ];

  for (const check of checks) {
    const decision = check();

    if (decision) {
      return decision;
    }
  }

  return { status: SandboxPolicyDecisionStatuses.Allow, reason: "allowed" };
}
