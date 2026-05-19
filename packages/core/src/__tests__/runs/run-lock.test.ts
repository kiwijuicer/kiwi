import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { readAuditEvents } from "../../ledger/cost-ledger.js";
import { ensureRunLayout } from "../../runs/store.js";
import { acquireRunLock, forceReleaseRunLock, listRunLocks, withRunLock } from "../../runs/lock.js";

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

  it("reclaims a stale lock before acquiring", () => {
    const repo = cwd();
    const layout = ensureRunLayout("run_demo", repo);
    const lockPath = path.join(layout.baseDir, "run.lock");

    writeFileSync(
      lockPath,
      JSON.stringify({
        schemaVersion: "1",
        runId: "run_demo",
        operation: "crashed",
        ownerPid: 999999,
        acquiredAt: "2026-05-04T10:00:00.000Z",
      }),
      "utf-8",
    );

    const lock = acquireRunLock({ cwd: repo, runId: "run_demo", operation: "reclaim" });

    try {
      expect(JSON.parse(readFileSync(lockPath, "utf-8"))).toMatchObject({ operation: "reclaim" });
    } finally {
      lock.release();
    }
    const events = readAuditEvents(repo, "run_demo").map((event) => event.eventType);

    expect(events).toContain("run_lock_reclaimed");
    expect(events).toContain("run_lock_acquired");
  });

  it("lists stale locks and force-releases them with an approver identity", () => {
    const repo = cwd();
    const layout = ensureRunLayout("run_demo", repo);
    const lockPath = path.join(layout.baseDir, "run.lock");

    writeFileSync(
      lockPath,
      JSON.stringify({
        schemaVersion: "1",
        runId: "run_demo",
        operation: "crashed",
        ownerPid: 999999,
        acquiredAt: "2026-05-04T10:00:00.000Z",
      }),
      "utf-8",
    );

    expect(listRunLocks(repo)).toMatchObject([{ runId: "run_demo", stale: true }]);
    const result = forceReleaseRunLock({ cwd: repo, runId: "run_demo", approvedBy: "norbert" });

    expect(result).toMatchObject({ released: true, stale: true, forced: false });
    expect(existsSync(lockPath)).toBe(false);
    expect(readAuditEvents(repo, "run_demo").at(-1)).toMatchObject({
      eventType: "run_lock_forced_release",
      payload: { approvedBy: "norbert", stale: true },
    });
  });

  it("does not release a lock owned by another live pid", () => {
    const repo = cwd();
    const lock = acquireRunLock({ cwd: repo, runId: "run_demo", operation: "outer" });

    try {
      expect(() => forceReleaseRunLock({ cwd: repo, runId: "run_demo", approvedBy: "norbert" })).toThrow(
        "Run is locked: run_demo",
      );
    } finally {
      lock.release();
    }
  });
});
