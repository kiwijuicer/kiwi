import { spawn } from "child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import path from "path";
import { Artifact, GateResult, GateResultSchema } from "@ai-kiwi/contracts";

export type ApprovalState = "auto" | "required" | "blocked";
export type NetworkPolicy = "disabled" | "enabled";
export type SandboxExecutionStatus =
  | "completed"
  | "failed"
  | "blocked"
  | "approval_required"
  | "timeout";

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

export interface WorktreeSandbox {
  runId: string;
  attemptId: string;
  worktreePath: string;
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

interface PolicyDecision {
  status: "allow" | "blocked" | "approval_required";
  reason: string;
}

const NETWORK_COMMANDS = new Set(["curl", "wget", "ssh", "scp", "git", "npm", "pnpm", "yarn"]);

function runsRoot(cwd: string): string {
  return path.join(cwd, ".kiwi", "runs");
}

function runDir(cwd: string, runId: string): string {
  return path.join(runsRoot(cwd), runId);
}

function auditLogPath(cwd: string): string {
  return path.join(cwd, ".kiwi", "logs", "audit.log");
}

function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

function appendAuditEvent(cwd: string, event: Record<string, unknown>): void {
  const target = auditLogPath(cwd);
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify(event)}\n`, "utf-8");
}

function resolveRunArtifactPath(cwd: string, runId: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error("artifact path must be relative to run directory");
  }

  const base = path.resolve(runDir(cwd, runId));
  const target = path.resolve(base, relativePath);
  if (!(target === base || target.startsWith(`${base}${path.sep}`))) {
    throw new Error(`artifact path escapes run directory: ${relativePath}`);
  }
  return target;
}

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
  if (NETWORK_COMMANDS.has(executable)) return true;
  return command.some((arg) => /^https?:\/\//i.test(arg));
}

function evaluatePolicy(input: SandboxCommandInput): PolicyDecision {
  if (input.command.length === 0) {
    return { status: "blocked", reason: "empty command" };
  }
  if (input.policy.approvalState === "blocked") {
    return { status: "blocked", reason: "command approval state is blocked" };
  }
  if (!commandAllowed(input.command, input.policy.allowedCommands)) {
    return { status: "blocked", reason: "command is not allowlisted" };
  }
  if (input.policy.networkPolicy === "disabled" && usesNetwork(input.command)) {
    return { status: "blocked", reason: "network access is disabled for this attempt" };
  }
  if (commandTouchesPath(input.command, input.worktreePath, input.policy.deniedPaths)) {
    return { status: "blocked", reason: "command touches a denied path" };
  }
  const needsPathApproval = commandTouchesPath(
    input.command,
    input.worktreePath,
    input.policy.approvalRequiredPaths,
  );
  if ((input.policy.approvalState === "required" || needsPathApproval) && !input.approved) {
    return { status: "approval_required", reason: "explicit approval is required" };
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

function allowedEnv(env: Record<string, string> | undefined, allowlist: string[]): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const key of allowlist) {
    const value = env?.[key] ?? process.env[key];
    if (value !== undefined) selected[key] = value;
  }
  return selected;
}

function gateResult(params: {
  status: "pass" | "fail" | "blocked";
  reason: string;
  evidenceRefs: string[];
}): GateResult {
  return GateResultSchema.parse({
    gateId: "gate_command_execution",
    gateType: "forbidden_file_checks",
    status: params.status,
    evidenceRefs: params.evidenceRefs,
    reason: params.reason,
  });
}

function artifactRef(ref: string, createdAt: string): Artifact {
  return {
    type: "command_output",
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
}): string {
  const relativePath = `steps/${params.stepId}/${params.attemptId}/artifacts/command-output.json`;
  const target = resolveRunArtifactPath(params.cwd, params.runId, relativePath);
  writeJsonSafely(target, params.payload);
  return relativePath;
}

export function createWorktreeSandbox(params: {
  cwd: string;
  runId: string;
  attemptId: string;
}): WorktreeSandbox {
  const worktreePath = resolveRunArtifactPath(
    params.cwd,
    params.runId,
    `worktrees/${params.attemptId}`,
  );
  mkdirSync(worktreePath, { recursive: true });
  return {
    runId: params.runId,
    attemptId: params.attemptId,
    worktreePath,
  };
}

export async function executeSandboxCommand(input: SandboxCommandInput): Promise<SandboxCommandOutput> {
  const startedAt = (input.now ?? new Date()).toISOString();
  const policyDecision = evaluatePolicy(input);

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

  if (policyDecision.status !== "allow") {
    const completedAt = new Date().toISOString();
    const result = gateResult({
      status: "blocked",
      reason: policyDecision.reason,
      evidenceRefs: [],
    });
    return {
      status: policyDecision.status,
      exitCode: null,
      stdout: "",
      stderr: policyDecision.reason,
      artifactRefs: [],
      gateResult: result,
      startedAt,
      completedAt,
    };
  }

  mkdirSync(input.worktreePath, { recursive: true });

  return new Promise((resolve) => {
    const child = spawn(input.command[0]!, input.command.slice(1), {
      cwd: input.worktreePath,
      env: allowedEnv(input.env, input.policy.envAllowlist),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.policy.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = truncate(stdout + chunk.toString("utf-8"), input.policy.maxOutputBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = truncate(stderr + chunk.toString("utf-8"), input.policy.maxOutputBytes);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      const completedAt = new Date().toISOString();
      const redactedStdout = redact(stdout, input.policy.secretValues);
      const redactedStderr = redact(stderr, input.policy.secretValues);
      const status: SandboxExecutionStatus =
        timedOut ? "timeout" : exitCode === 0 ? "completed" : "failed";
      const outputRef = persistOutput({
        cwd: input.cwd,
        runId: input.runId,
        stepId: input.stepId,
        attemptId: input.attemptId,
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
      const artifactRefs = [artifactRef(outputRef, completedAt)];
      const result = gateResult({
        status: status === "completed" ? "pass" : "fail",
        reason:
          status === "completed"
            ? "Command completed successfully"
            : status === "timeout"
              ? "Command timed out"
              : "Command failed",
        evidenceRefs: [outputRef],
      });

      appendAuditEvent(input.cwd, {
        eventType: status === "timeout" ? "sandbox_command_timeout" : "sandbox_command_completed",
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

      resolve({
        status,
        exitCode,
        stdout: redactedStdout,
        stderr: redactedStderr,
        artifactRefs,
        gateResult: result,
        startedAt,
        completedAt,
      });
    });
  });
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
