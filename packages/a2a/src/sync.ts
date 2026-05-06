import { existsSync, mkdirSync, readdirSync } from "fs";
import path from "path";
import { A2ATrustedPeer, ProtocolEnvelopeSchema } from "@kiwi/contracts";
import {
  appendA2AAudit,
  atomicCopyFile,
  copyDirContents,
  moveA2AFile,
  readJson,
  resolveA2APath,
  safeFileName,
  writeJsonSafely,
} from "./common";
import { a2aPolicyFromConfig, loadA2AConfig, requireEnabledConfig } from "./config";
import { handleA2AEnvelope } from "./receive";
import { ensureA2AStorage } from "./config";
import type { A2AImportDecision, A2ASyncResult } from "./types";

function deliverPeerOutbox(params: { cwd: string; peer: A2ATrustedPeer }): string[] {
  const delivered: string[] = [];
  const outboxRef = `outbox/${safeFileName(params.peer.agentId)}`;
  const outboxDir = resolveA2APath(params.cwd, outboxRef);
  if (!existsSync(outboxDir)) return delivered;
  const inboxPath = path.isAbsolute(params.peer.inboxPath)
    ? params.peer.inboxPath
    : path.resolve(params.cwd, params.peer.inboxPath);
  mkdirSync(inboxPath, { recursive: true });

  for (const entry of readdirSync(outboxDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const source = path.join(outboxDir, entry.name);
    const envelope = ProtocolEnvelopeSchema.parse(readJson(source));
    const messageId = envelope.a2a?.messageId ?? entry.name.replace(/\.json$/, "");
    const sourceAttachments = path.join(outboxDir, "attachments", safeFileName(messageId));
    const targetAttachments = path.join(inboxPath, "attachments", safeFileName(messageId));
    copyDirContents(sourceAttachments, targetAttachments);
    atomicCopyFile(source, path.join(inboxPath, `${safeFileName(messageId)}.json`));
    moveA2AFile({
      cwd: params.cwd,
      source,
      targetRef: `ledger/outbox/${safeFileName(params.peer.agentId)}/${entry.name}`,
    });
    delivered.push(`${params.peer.agentId}/${entry.name}`);
  }

  return delivered;
}

function quarantineCorruptIncoming(params: {
  cwd: string;
  source: string;
  fileName: string;
  reason: string;
  timestamp: string;
}): string {
  const ref = `quarantine/corrupt-${Date.now()}-${safeFileName(params.fileName)}`;
  writeJsonSafely(resolveA2APath(params.cwd, `${ref}.reason.json`), {
    reason: params.reason,
    source: params.fileName,
    createdAt: params.timestamp,
  });
  moveA2AFile({ cwd: params.cwd, source: params.source, targetRef: ref });
  appendA2AAudit({
    cwd: params.cwd,
    eventType: "a2a_incoming_corrupt",
    timestamp: params.timestamp,
    payload: { reason: params.reason, source: params.fileName, quarantineRef: ref },
  });
  return ref;
}

export function importA2AIncoming(params: { cwd: string; now?: Date }): A2ASyncResult {
  ensureA2AStorage(params.cwd);
  const timestamp = (params.now ?? new Date()).toISOString();
  const config = loadA2AConfig(params.cwd);
  const policy = a2aPolicyFromConfig(config);
  const incomingRoot = resolveA2APath(params.cwd, "transport/incoming");
  const result: A2ASyncResult = {
    delivered: [],
    imported: [],
    blocked: [],
    duplicates: [],
    quarantined: [],
  };

  for (const entry of readdirSync(incomingRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const source = path.join(incomingRoot, entry.name);
    try {
      const envelope = readJson(source);
      const handled = handleA2AEnvelope({
        cwd: params.cwd,
        envelope,
        policy,
        incomingRoot,
        now: params.now,
      });
      const imported: A2AImportDecision = {
        sourceRef: `transport/incoming/${entry.name}`,
        decision: handled.decision,
      };
      if (handled.decision.status === "accepted") {
        result.imported.push(imported);
        if (handled.decision.quarantineRef) result.quarantined.push(handled.decision.quarantineRef);
        moveA2AFile({ cwd: params.cwd, source, targetRef: `ledger/imported/${entry.name}` });
      } else if (handled.decision.status === "duplicate") {
        result.duplicates.push(imported);
        moveA2AFile({ cwd: params.cwd, source, targetRef: `ledger/duplicates/${entry.name}` });
      } else {
        result.blocked.push(imported);
        moveA2AFile({ cwd: params.cwd, source, targetRef: `ledger/blocked/${entry.name}` });
      }
    } catch (error) {
      const ref = quarantineCorruptIncoming({
        cwd: params.cwd,
        source,
        fileName: entry.name,
        reason: error instanceof Error ? error.message : String(error),
        timestamp,
      });
      result.quarantined.push(ref);
    }
  }

  return result;
}

export function syncA2AFilesystem(params: { cwd: string; now?: Date }): A2ASyncResult {
  ensureA2AStorage(params.cwd);
  const config = requireEnabledConfig(params.cwd);
  const delivered = config.peers.flatMap((peer) => deliverPeerOutbox({ cwd: params.cwd, peer }));
  const imported = importA2AIncoming(params);
  return {
    ...imported,
    delivered,
  };
}
