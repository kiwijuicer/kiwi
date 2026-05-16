import { describe, expect, it } from "vitest";
import { runSubprocess } from "../subprocess";

describe("runSubprocess – streaming (onOutputChunk)", () => {
  it("collects stdout chunks before resolve and matches full stdout", async () => {
    const chunks: { stream: "stdout" | "stderr"; text: string }[] = [];
    const result = await runSubprocess({
      binary: "node",
      args: ["-e", "process.stdout.write('hello '); process.stdout.write('world');"],
      timeoutMs: 5_000,
      onOutputChunk: (chunk) => chunks.push(chunk),
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("hello world");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const combined = chunks
      .filter((c) => c.stream === "stdout")
      .map((c) => c.text)
      .join("");
    expect(combined).toBe("hello world");
  });

  it("collects stderr chunks separately", async () => {
    const chunks: { stream: "stdout" | "stderr"; text: string }[] = [];
    const result = await runSubprocess({
      binary: "node",
      args: ["-e", "process.stderr.write('err-line');"],
      timeoutMs: 5_000,
      onOutputChunk: (chunk) => chunks.push(chunk),
    });

    expect(result.stderr).toBe("err-line");
    const stderrText = chunks
      .filter((c) => c.stream === "stderr")
      .map((c) => c.text)
      .join("");
    expect(stderrText).toBe("err-line");
  });

  it("works without onOutputChunk (backwards compat)", async () => {
    const result = await runSubprocess({
      binary: "node",
      args: ["-e", "process.stdout.write('no-callback');"],
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("no-callback");
  });

  it("TTY: spawned child has no TTY on stdout", async () => {
    const result = await runSubprocess({
      binary: "node",
      args: ["-e", "process.stdout.write(String(!!process.stdout.isTTY));"],
      timeoutMs: 5_000,
    });
    expect(result.stdout.trim()).toBe("false");
  });

  it("TTY: spawned child has no TTY on stderr", async () => {
    const result = await runSubprocess({
      binary: "node",
      args: ["-e", "process.stderr.write(String(!!process.stderr.isTTY));"],
      timeoutMs: 5_000,
    });
    expect(result.stderr.trim()).toBe("false");
  });

  it("onOutputChunk is called before resolve (streaming contract)", async () => {
    const callOrder: string[] = [];
    const result = await runSubprocess({
      binary: "node",
      args: ["-e", "process.stdout.write('chunk1'); process.stdout.write('chunk2');"],
      timeoutMs: 5_000,
      onOutputChunk: (chunk) => callOrder.push(`chunk:${chunk.text}`),
    });
    callOrder.push("resolved");

    // Chunks must appear before "resolved" in callOrder
    const resolvedIdx = callOrder.indexOf("resolved");
    const chunkIdxs = callOrder.map((v, i) => (v.startsWith("chunk:") ? i : -1)).filter((i) => i >= 0);
    expect(chunkIdxs.length).toBeGreaterThan(0);
    for (const idx of chunkIdxs) {
      expect(idx).toBeLessThan(resolvedIdx);
    }
    expect(result.ok).toBe(true);
  });
});
