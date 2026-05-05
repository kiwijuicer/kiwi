import { spawn } from "child_process";

interface SubprocessInvocation {
  binary: string;
  args: string[];
  cwd?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  timeoutMs: number;
  maxOutputBytes?: number | undefined;
}

interface SubprocessResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  binary: string;
  args: string[];
  timedOut: boolean;
}

function selectedEnv(env: Record<string, string | undefined> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function truncate(value: string, maxBytes: number | undefined): string {
  if (!maxBytes) return value;
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

export async function runSubprocess(invocation: SubprocessInvocation): Promise<SubprocessResult> {
  const startedAt = new Date();
  return await new Promise<SubprocessResult>((resolve) => {
    const child = spawn(invocation.binary, invocation.args, {
      cwd: invocation.cwd,
      env: selectedEnv(invocation.env),
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
    }, invocation.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = truncate(stdout + chunk.toString("utf-8"), invocation.maxOutputBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = truncate(stderr + chunk.toString("utf-8"), invocation.maxOutputBytes);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      const completedAt = new Date();
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: stderr || (error instanceof Error ? error.message : String(error)),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        binary: invocation.binary,
        args: invocation.args,
        timedOut,
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      const completedAt = new Date();
      resolve({
        ok: !timedOut && exitCode === 0,
        exitCode,
        stdout,
        stderr,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        binary: invocation.binary,
        args: invocation.args,
        timedOut,
      });
    });
  });
}
