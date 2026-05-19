import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { appendAuditEvent, AuditEventTypes } from "../ledger/cost-ledger";
import { ensureRunLayout, listRunIds, resolveRunArtifactPath } from "./store";

export interface RunLockInfo {
  schemaVersion: "1";
  runId: string;
  operation: string;
  ownerPid: number;
  acquiredAt: string;
  expiresAt?: string | null;
}

export interface RunLock {
  info: RunLockInfo;
  ref: string;
  release: () => void;
}

export interface RunLockStatus {
  runId: string;
  ref: string;
  path: string;
  existing: unknown;
  ownerAlive: boolean | null;
  stale: boolean;
}

export interface RunLockReleaseResult {
  runId: string;
  released: boolean;
  existed: boolean;
  stale: boolean;
  forced: boolean;
  existing: unknown;
}

export class RunLockBusyError extends Error {
  readonly runId: string;
  readonly operation: string;
  readonly existing: unknown;

  constructor(params: { runId: string; operation: string; existing: unknown }) {
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

function lockTarget(cwd: string, runId: string): { ref: string; target: string } {
  const ref = lockRef();

  return { ref, target: resolveRunArtifactPath(runId, ref, cwd) };
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

function parsedRunLockInfo(value: unknown): RunLockInfo | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<RunLockInfo>;

  if (
    candidate.schemaVersion !== "1" ||
    typeof candidate.runId !== "string" ||
    typeof candidate.operation !== "string" ||
    typeof candidate.ownerPid !== "number" ||
    typeof candidate.acquiredAt !== "string"
  ) {
    return null;
  }

  return {
    schemaVersion: "1",
    runId: candidate.runId,
    operation: candidate.operation,
    ownerPid: candidate.ownerPid,
    acquiredAt: candidate.acquiredAt,
    ...(typeof candidate.expiresAt === "string" || candidate.expiresAt === null
      ? { expiresAt: candidate.expiresAt }
      : {}),
  };
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    throw error;
  }
}

function lockOwnerAlive(existing: unknown): boolean | null {
  const info = parsedRunLockInfo(existing);

  return info ? isProcessAlive(info.ownerPid) : null;
}

function auditLockReclaimed(params: {
  cwd: string;
  runId: string;
  operation: string;
  existing: unknown;
  target: string;
}): void {
  appendAuditEvent(params.cwd, {
    eventType: AuditEventTypes.RunLockReclaimed,
    runId: params.runId,
    timestamp: new Date().toISOString(),
    payload: {
      operation: params.operation,
      lockPath: params.target,
      existing: params.existing,
    },
  });
}

export function acquireRunLock(params: {
  cwd: string;
  runId: string;
  operation: string;
  now?: Date | undefined;
}): RunLock {
  ensureRunLayout(params.runId, params.cwd);
  const { ref, target } = lockTarget(params.cwd, params.runId);
  const info: RunLockInfo = {
    schemaVersion: "1",
    runId: params.runId,
    operation: params.operation,
    ownerPid: process.pid,
    acquiredAt: (params.now ?? new Date()).toISOString(),
  };
  let descriptor: number | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = openSync(target, "wx");
      break;
    } catch (error) {
      const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

      if (code !== "EEXIST") {
        throw error;
      }
      const existing = readExistingLock(target);
      const ownerAlive = lockOwnerAlive(existing);

      if (ownerAlive === false && existsSync(target)) {
        unlinkSync(target);
        auditLockReclaimed({ cwd: params.cwd, runId: params.runId, operation: params.operation, existing, target });
        continue;
      }
      appendAuditEvent(params.cwd, {
        eventType: AuditEventTypes.RunLockBusy,
        runId: params.runId,
        timestamp: new Date().toISOString(),
        payload: {
          operation: params.operation,
          existing,
          ownerAlive,
        },
      });
      throw new RunLockBusyError({
        runId: params.runId,
        operation: params.operation,
        existing,
      });
    }
  }

  if (descriptor === null) {
    throw new Error(`Could not acquire run lock after stale recovery: ${params.runId}`);
  }

  writeFileSync(descriptor, JSON.stringify(info, null, 2), "utf-8");
  closeSync(descriptor);
  appendAuditEvent(params.cwd, {
    eventType: AuditEventTypes.RunLockAcquired,
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
        const existing = parsedRunLockInfo(readExistingLock(target));

        if (existing?.ownerPid === process.pid) {
          unlinkSync(target);
        }
      }
      appendAuditEvent(params.cwd, {
        eventType: AuditEventTypes.RunLockReleased,
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

export function inspectRunLock(cwd: string, runId: string): RunLockStatus | null {
  const { ref, target } = lockTarget(cwd, runId);

  if (!existsSync(target)) {
    return null;
  }
  const existing = readExistingLock(target);
  const ownerAlive = lockOwnerAlive(existing);

  return {
    runId,
    ref,
    path: target,
    existing,
    ownerAlive,
    stale: ownerAlive === false,
  };
}

export function listRunLocks(cwd: string): RunLockStatus[] {
  return listRunIds(cwd)
    .map((runId) => inspectRunLock(cwd, runId))
    .filter((entry): entry is RunLockStatus => entry !== null);
}

export function forceReleaseRunLock(params: {
  cwd: string;
  runId: string;
  force?: boolean;
  approvedBy: string;
  now?: Date;
}): RunLockReleaseResult {
  ensureRunLayout(params.runId, params.cwd);
  const { ref, target } = lockTarget(params.cwd, params.runId);
  const existing = readExistingLock(target);
  const ownerAlive = existing ? lockOwnerAlive(existing) : null;
  const stale = ownerAlive === false;

  if (!existing) {
    return {
      runId: params.runId,
      released: false,
      existed: false,
      stale: false,
      forced: params.force === true,
      existing,
    };
  }
  if (ownerAlive === true && params.force !== true) {
    throw new RunLockBusyError({ runId: params.runId, operation: "unlock", existing });
  }
  unlinkSync(target);
  appendAuditEvent(params.cwd, {
    eventType: AuditEventTypes.RunLockForcedRelease,
    runId: params.runId,
    timestamp: (params.now ?? new Date()).toISOString(),
    payload: {
      lockRef: ref,
      approvedBy: params.approvedBy,
      forced: params.force === true,
      stale,
      existing,
    },
  });

  return {
    runId: params.runId,
    released: true,
    existed: true,
    stale,
    forced: params.force === true,
    existing,
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
