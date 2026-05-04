import { spawn } from "child_process";
import { mkdirSync } from "fs";
import path from "path";
import {
  ApprovalStates,
  Artifact,
  ArtifactTypes,
  ContractValues,
  GateResult,
  GateResultSchema,
  GateType,
  NetworkPolicies,
  RunnerExecutionStatuses,
} from "@kiwi/contracts";
import { appendAuditEvent, resolveRunArtifactPath, writeJsonSafely } from "./common";

export type ApprovalState = "auto" | "required" | "blocked";
export type NetworkPolicy = "disabled" | "enabled";
export type SandboxExecutionStatus = "completed" | "failed" | "blocked" | "approval_required" | "timeout";

export interface SandboxCommandPolicy {
  allowedCommands: string[];
  approvalState: ApprovalState;
  approvalRequiredPaths: string[];
  deniedPaths: string[];
  envAllowlist: string[];
  secretValues: string[];
  networkPolicy: NetworkPolicy;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface SandboxCommandInput {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  worktreePath: string;
  command: string[];
  policy: SandboxCommandPolicy;
  env?: Record<string, string>;
  approved?: boolean;
  now?: Date;
  gateId?: string;
  gateType?: GateType;
  artifactLabel?: string;
}

export interface SandboxCommandOutput {
  status: SandboxExecutionStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  artifactRefs: Artifact[];
  gateResult: GateResult;
  startedAt: string;
  completedAt: string;
}

type PolicyDecision =
  | { status: "allow"; reason: string }
  | { status: typeof ContractValues.Blocked | typeof APPROVAL_REQUIRED; reason: string };

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
const APPROVAL_REQUIRED = RunnerExecutionStatuses.ApprovalRequired;
const TIMEOUT = RunnerExecutionStatuses.Timeout;

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
    if (!arg.includes("/") && !arg.startsWith(".")) return false;
    const normalized = normalizePathForMatch(worktreePath, arg);
    return patterns.some((pattern) => matchesPathPattern(normalized, pattern));
  });
}

function commandAllowed(command: string[], allowedCommands: string[]): boolean {
  const executable = command[0];
  if (!executable) return false;
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
  if (NETWORK_COMMANDS.has(executable)) return true;
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
    if (token.startsWith("--") && token.includes("=")) continue;
    if (token.startsWith("-")) continue;
    return token;
  }
  return null;
}

function requiresExplicitGitMutationApproval(command: string[]): boolean {
  return command.some((token, index) => {
    if (path.basename(token) !== "git") return false;
    const subcommand = gitSubcommand(command, index);
    return subcommand !== null && MUTATING_GIT_SUBCOMMANDS.has(subcommand);
  });
}

function blocked(reason: string): PolicyDecision {
  return { status: ContractValues.Blocked, reason };
}

function approvalRequired(reason: string): PolicyDecision {
  return { status: APPROVAL_REQUIRED, reason };
}

function evaluatePolicy(input: SandboxCommandInput): PolicyDecision {
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
    if (decision) return decision;
  }
  return { status: "allow", reason: "allowed" };
}

function redact(value: string, secretValues: string[]): string {
  return secretValues
    .filter((secret) => secret.length > 0)
    .reduce((current, secret) => current.split(secret).join("[REDACTED]"), value);
}

function truncate(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maxBytes) return value;
  return `${buffer.subarray(0, maxBytes).toString("utf-8")}\n[truncated]`;
}

function terminateProcessTree(childPid: number | undefined, childKill: () => void): NodeJS.Timeout | null {
  if (!childPid) {
    childKill();
    return null;
  }
  if (process.platform !== "win32") {
    try {
      process.kill(-childPid, "SIGTERM");
    } catch {
      childKill();
    }
    return setTimeout(() => {
      try {
        process.kill(-childPid, "SIGKILL");
      } catch {
        // Process already exited.
      }
    }, 2_000);
  }
  childKill();
  return null;
}

function allowedEnv(env: Record<string, string> | undefined, allowlist: string[]): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const key of allowlist) {
    const value = env?.[key] ?? process.env[key];
    if (value !== undefined) selected[key] = value;
  }
  return selected;
}

function gateResult(params: {
  gateId?: string;
  gateType?: GateType;
  status: typeof ContractValues.Pass | typeof ContractValues.Fail | typeof ContractValues.Blocked;
  reason: string;
  evidenceRefs: string[];
}): GateResult {
  return GateResultSchema.parse({
    gateId: params.gateId ?? "gate_command_execution",
    gateType: params.gateType ?? "forbidden_file_checks",
    status: params.status,
    evidenceRefs: params.evidenceRefs,
    reason: params.reason,
  });
}

function artifactRef(ref: string, createdAt: string): Artifact {
  return {
    type: ArtifactTypes.CommandOutput,
    ref,
    createdAt,
  };
}

function persistOutput(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  payload: unknown;
  artifactLabel?: string;
}): string {
  const suffix = params.artifactLabel ? `-${params.artifactLabel.replace(/[^a-z0-9_-]/gi, "_")}` : "";
  const relativePath = `steps/${params.stepId}/${params.attemptId}/artifacts/command-output${suffix}.json`;
  const target = resolveRunArtifactPath(params.cwd, params.runId, relativePath);
  writeJsonSafely(target, params.payload);
  return relativePath;
}

function auditPolicyDecision(input: SandboxCommandInput, startedAt: string, policyDecision: PolicyDecision): void {
  appendAuditEvent(input.cwd, {
    eventType: policyDecision.status === "allow" ? "sandbox_command_allowed" : "sandbox_command_blocked",
    runId: input.runId,
    timestamp: startedAt,
    payload: {
      stepId: input.stepId,
      attemptId: input.attemptId,
      command: input.command,
      status: policyDecision.status,
      reason: policyDecision.reason,
    },
  });
}

function blockedOutput(
  input: SandboxCommandInput,
  startedAt: string,
  policyDecision: { status: typeof ContractValues.Blocked | typeof APPROVAL_REQUIRED; reason: string },
): SandboxCommandOutput {
  const completedAt = new Date().toISOString();
  const blockedGateParams: Parameters<typeof gateResult>[0] = {
    status: ContractValues.Blocked,
    reason: policyDecision.reason,
    evidenceRefs: [],
  };
  if (input.gateId) blockedGateParams.gateId = input.gateId;
  if (input.gateType) blockedGateParams.gateType = input.gateType;
  return {
    status: policyDecision.status,
    exitCode: null,
    stdout: "",
    stderr: policyDecision.reason,
    artifactRefs: [],
    gateResult: gateResult(blockedGateParams),
    startedAt,
    completedAt,
  };
}

function resolveStatus(timedOut: boolean, exitCode: number | null): SandboxExecutionStatus {
  if (timedOut) return TIMEOUT;
  return exitCode === 0 ? ContractValues.Completed : ContractValues.Failed;
}

function gateReason(status: SandboxExecutionStatus): string {
  if (status === ContractValues.Completed) return "Command completed successfully";
  if (status === TIMEOUT) return "Command timed out";
  return "Command failed";
}

function finishCommand(params: {
  input: SandboxCommandInput;
  startedAt: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}): SandboxCommandOutput {
  const { input, startedAt, exitCode, timedOut } = params;
  const completedAt = new Date().toISOString();
  const redactedStdout = redact(params.stdout, input.policy.secretValues);
  const redactedStderr = redact(params.stderr, input.policy.secretValues);
  const status = resolveStatus(timedOut, exitCode);
  const outputRef = persistOutput({
    cwd: input.cwd,
    runId: input.runId,
    stepId: input.stepId,
    attemptId: input.attemptId,
    ...(input.artifactLabel ? { artifactLabel: input.artifactLabel } : {}),
    payload: {
      command: input.command,
      status,
      exitCode,
      stdout: redactedStdout,
      stderr: redactedStderr,
      startedAt,
      completedAt,
    },
  });
  const gateParams: Parameters<typeof gateResult>[0] = {
    status: status === ContractValues.Completed ? ContractValues.Pass : ContractValues.Fail,
    reason: gateReason(status),
    evidenceRefs: [outputRef],
  };
  if (input.gateId) gateParams.gateId = input.gateId;
  if (input.gateType) gateParams.gateType = input.gateType;

  appendAuditEvent(input.cwd, {
    eventType: status === TIMEOUT ? "sandbox_command_timeout" : "sandbox_command_completed",
    runId: input.runId,
    timestamp: completedAt,
    payload: {
      stepId: input.stepId,
      attemptId: input.attemptId,
      status,
      exitCode,
      artifactRefs: [outputRef],
    },
  });

  return {
    status,
    exitCode,
    stdout: redactedStdout,
    stderr: redactedStderr,
    artifactRefs: [artifactRef(outputRef, completedAt)],
    gateResult: gateResult(gateParams),
    startedAt,
    completedAt,
  };
}

function spawnSandboxCommand(input: SandboxCommandInput, startedAt: string): Promise<SandboxCommandOutput> {
  return new Promise((resolve) => {
    const child = spawn(input.command[0]!, input.command.slice(1), {
      cwd: input.worktreePath,
      env: allowedEnv(input.env, input.policy.envAllowlist),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      killTimer = terminateProcessTree(child.pid, () => child.kill("SIGTERM"));
    }, input.policy.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = truncate(stdout + chunk.toString("utf-8"), input.policy.maxOutputBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = truncate(stderr + chunk.toString("utf-8"), input.policy.maxOutputBytes);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve(finishCommand({ input, startedAt, exitCode, timedOut, stdout, stderr }));
    });
  });
}

export async function executeSandboxCommand(input: SandboxCommandInput): Promise<SandboxCommandOutput> {
  const startedAt = (input.now ?? new Date()).toISOString();
  const policyDecision = evaluatePolicy(input);
  auditPolicyDecision(input, startedAt, policyDecision);
  if (policyDecision.status === "allow") {
    mkdirSync(input.worktreePath, { recursive: true });
    return spawnSandboxCommand(input, startedAt);
  }

  return blockedOutput(input, startedAt, policyDecision);
}
