import { mkdirSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStreamingRunnerLog } from "../../runners/logs";
import { readFileSync, rmSync, existsSync } from "fs";

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `kiwi-stream-test-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  return dir;
}

describe("openStreamingRunnerLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    mkdirSync(path.join(tmpDir, ".kiwi", "runs", "run-1", "steps", "step-1", "attempt-1", "artifacts"), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the stream file and writes NDJSON lines on append", () => {
    const log = openStreamingRunnerLog({
      workspacePath: tmpDir,
      runId: "run-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      runner: "claude-code",
    });

    log.append({ stream: "stdout", text: "hello " });
    log.append({ stream: "stdout", text: "world" });
    log.append({ stream: "stderr", text: "err-line" });
    log.close();

    expect(existsSync(log.path)).toBe(true);
    const lines = readFileSync(log.path, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(3);

    const parsed = lines.map((l) => JSON.parse(l) as unknown);
    expect(parsed[0]).toMatchObject({ stream: "stdout", text: "hello " });
    expect(parsed[1]).toMatchObject({ stream: "stdout", text: "world" });
    expect(parsed[2]).toMatchObject({ stream: "stderr", text: "err-line" });
  });

  it("redacts secrets in appended chunks", () => {
    const log = openStreamingRunnerLog({
      workspacePath: tmpDir,
      runId: "run-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      runner: "claude-code",
      secretValues: ["supersecret"],
    });

    log.append({ stream: "stdout", text: "token=supersecret ok" });
    log.close();

    const content = readFileSync(log.path, "utf-8");
    expect(content).not.toContain("supersecret");
    expect(content).toContain("[REDACTED]");
  });

  it("redacts sk-ant- tokens automatically", () => {
    const log = openStreamingRunnerLog({
      workspacePath: tmpDir,
      runId: "run-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      runner: "claude-code",
    });

    log.append({ stream: "stdout", text: "key=sk-ant-api03-ABCDEFGHIJKLMNOP" });
    log.close();

    const content = readFileSync(log.path, "utf-8");
    expect(content).not.toContain("sk-ant-api03");
    expect(content).toContain("[REDACTED]");
  });

  it("ref points to a .jsonl file inside the run directory", () => {
    const log = openStreamingRunnerLog({
      workspacePath: tmpDir,
      runId: "run-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      runner: "claude-code",
    });
    expect(log.ref).toMatch(/\.jsonl$/);
    expect(log.ref).toContain("step-1");
    expect(log.ref).toContain("attempt-1");
  });

  it("each appended line has a timestamp field", () => {
    const log = openStreamingRunnerLog({
      workspacePath: tmpDir,
      runId: "run-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      runner: "claude-code",
    });
    log.append({ stream: "stdout", text: "timestamped" });
    log.close();

    const line = readFileSync(log.path, "utf-8").trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(typeof parsed["t"]).toBe("string");
    expect(new Date(parsed["t"] as string).getTime()).not.toBeNaN();
  });
});
