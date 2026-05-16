import { spawn } from "child_process";
import { terminateProcessTree, truncateOutput } from "@kiwi/sandbox";
import { SubprocessStreams, type SubprocessStream } from "./constants";

export interface SubprocessOutputChunk {
  stream: SubprocessStream;
  text: string;
}

interface SubprocessInvocation {
  binary: string;
  args: string[];
  cwd?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  timeoutMs: number;
  maxOutputBytes?: number | undefined;
  /** Called for each stdout/stderr chunk as it arrives. Optional; does not affect the returned result. */
  onOutputChunk?: (chunk: SubprocessOutputChunk) => void;
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
  if (env === undefined) {
    return selectedEnv(process.env);
  }
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }

  return out;
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
      const text = chunk.toString("utf-8");
      stdout = truncateOutput(stdout + text, invocation.maxOutputBytes);
      invocation.onOutputChunk?.({ stream: SubprocessStreams.Stdout, text });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stderr = truncateOutput(stderr + text, invocation.maxOutputBytes);
      invocation.onOutputChunk?.({ stream: SubprocessStreams.Stderr, text });
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (killTimer) {
        clearTimeout(killTimer);
      }
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
      if (killTimer) {
        clearTimeout(killTimer);
      }
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
