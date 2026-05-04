import { existsSync, mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { readAuditEvents } from "../cost-ledger";
import { withRunLock } from "../run-lock";

function cwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-run-lock-"));
}

describe("run locks", () => {
  it("serializes mutations and releases the lock after completion", async () => {
    const repo = cwd();
    const lockPath = path.join(repo, ".kiwi", "runs", "run_demo", "run.lock");

    await withRunLock(
      {
        cwd: repo,
        runId: "run_demo",
        operation: "outer",
        now: new Date("2026-05-04T10:00:00.000Z"),
      },
      async () => {
        expect(existsSync(lockPath)).toBe(true);
        await expect(
          withRunLock(
            {
              cwd: repo,
              runId: "run_demo",
              operation: "inner",
              now: new Date("2026-05-04T10:00:01.000Z"),
            },
            () => undefined,
          ),
        ).rejects.toThrow("Run is locked: run_demo");
      },
    );

    expect(existsSync(lockPath)).toBe(false);
    const events = readAuditEvents(repo, "run_demo").map((event) => event.eventType);
    expect(events).toContain("run_lock_acquired");
    expect(events).toContain("run_lock_busy");
    expect(events).toContain("run_lock_released");
  });

  it("releases the lock when a mutation fails", async () => {
    const repo = cwd();
    const lockPath = path.join(repo, ".kiwi", "runs", "run_demo", "run.lock");

    await expect(
      withRunLock(
        {
          cwd: repo,
          runId: "run_demo",
          operation: "failing",
        },
        () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");

    expect(existsSync(lockPath)).toBe(false);
  });
});
