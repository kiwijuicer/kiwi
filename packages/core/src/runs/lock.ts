import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { appendAuditEvent } from "../ledger/cost-ledger";
import { ensureRunLayout, resolveRunArtifactPath } from "./store";

export interface RunLockInfo {
  schemaVersion: "1";
  runId: string;
  operation: string;
  ownerPid: number;
  acquiredAt: string;
}

export interface RunLock {
  info: RunLockInfo;
  ref: string;
  release: () => void;
}

export class RunLockBusyError extends Error {
  readonly runId: string;
  readonly operation: string;
  readonly existing: unknown;

  constructor(params: {
    runId: string;
    operation: string;
    existing: unknown;
  }) {
    super(`Run is locked: ${params.runId}`);
    this.name = "RunLockBusyError";
    this.runId = params.runId;
    this.operation = params.operation;
    this.existing = params.existing;
  }
}

function lockRef(): string {
  return "run.lock";
}

function readExistingLock(target: string): unknown {
  if (!existsSync(target)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(target, "utf-8")) as unknown;
  } catch {
    return { unreadable: true };
  }
}

export function acquireRunLock(params: {
  cwd: string;
  runId: string;
  operation: string;
  now?: Date | undefined;
}): RunLock {
  ensureRunLayout(params.runId, params.cwd);
  const ref = lockRef();
  const target = resolveRunArtifactPath(params.runId, ref, params.cwd);
  const info: RunLockInfo = {
    schemaVersion: "1",
    runId: params.runId,
    operation: params.operation,
    ownerPid: process.pid,
    acquiredAt: (params.now ?? new Date()).toISOString(),
  };

  let descriptor: number;

  try {
    descriptor = openSync(target, "wx");
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

    if (code === "EEXIST") {
      const existing = readExistingLock(target);
      appendAuditEvent(params.cwd, {
        eventType: "run_lock_busy",
        runId: params.runId,
        timestamp: new Date().toISOString(),
        payload: {
          operation: params.operation,
          existing,
        },
      });
      throw new RunLockBusyError({
        runId: params.runId,
        operation: params.operation,
        existing,
      });
    }
    throw error;
  }

  writeFileSync(descriptor, JSON.stringify(info, null, 2), "utf-8");
  closeSync(descriptor);
  appendAuditEvent(params.cwd, {
    eventType: "run_lock_acquired",
    runId: params.runId,
    timestamp: info.acquiredAt,
    payload: {
      operation: params.operation,
      lockRef: ref,
    },
  });

  let released = false;

  return {
    info,
    ref,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      if (existsSync(target)) {
        unlinkSync(target);
      }
      appendAuditEvent(params.cwd, {
        eventType: "run_lock_released",
        runId: params.runId,
        timestamp: new Date().toISOString(),
        payload: {
          operation: params.operation,
          lockRef: ref,
        },
      });
    },
  };
}

export async function withRunLock<T>(
  params: {
    cwd: string;
    runId: string;
    operation: string;
    now?: Date | undefined;
  },
  action: () => Promise<T> | T,
): Promise<T> {
  const lock = acquireRunLock(params);

  try {
    return await action();
  } finally {
    lock.release();
  }
}
