export function truncateOutput(value: string, maxBytes: number | undefined): string {
  if (!maxBytes) return value;
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maxBytes) return value;
  return `${buffer.subarray(0, maxBytes).toString("utf-8")}\n[truncated]`;
}

export function terminateProcessTree(childPid: number | undefined, childKill: () => void): NodeJS.Timeout | null {
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
