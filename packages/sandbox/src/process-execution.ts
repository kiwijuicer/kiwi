import { spawn } from "child_process";
import { finishCommand } from "./command-artifacts";
import type { SandboxCommandInput, SandboxCommandOutput } from "./command-types";
import { terminateProcessTree, truncateOutput } from "./process-utils";

function allowedEnv(env: Record<string, string> | undefined, allowlist: string[]): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const key of allowlist) {
    const value = env?.[key] ?? process.env[key];
    if (value !== undefined) selected[key] = value;
  }
  return selected;
}

export function spawnSandboxCommand(input: SandboxCommandInput, startedAt: string): Promise<SandboxCommandOutput> {
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
      stdout = truncateOutput(stdout + chunk.toString("utf-8"), input.policy.maxOutputBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = truncateOutput(stderr + chunk.toString("utf-8"), input.policy.maxOutputBytes);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve(finishCommand({ input, startedAt, exitCode, timedOut, stdout, stderr }));
    });
  });
}
