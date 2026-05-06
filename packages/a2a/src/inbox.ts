import { readdirSync } from "fs";
import path from "path";
import { A2ARuntimeDecisionSchema, ContractValues, ProtocolEnvelopeSchema } from "@kiwi/contracts";
import { readJson, resolveA2APath } from "./common";
import { ensureA2AStorage } from "./config";
import type { A2AInboxItem } from "./types";

function inboxItemFromRecord(record: unknown, status: A2AInboxItem["status"]): A2AInboxItem {
  const value = record as {
    envelope?: unknown;
    decision?: unknown;
    materializedRunId?: unknown;
  };
  const envelope = ProtocolEnvelopeSchema.parse(value.envelope);
  const runtimeDecision = A2ARuntimeDecisionSchema.parse(value.decision);
  if (!envelope.a2a) {
    throw new Error("A2A inbox record is missing metadata");
  }
  const item: A2AInboxItem = {
    messageId: envelope.a2a.messageId,
    correlationId: envelope.a2a.correlationId,
    kind: envelope.kind,
    senderAgentId: envelope.a2a.senderAgentId,
    status,
    reason: runtimeDecision.reason,
    createdAt: runtimeDecision.createdAt,
  };
  if (runtimeDecision.inboxRef) item.inboxRef = runtimeDecision.inboxRef;
  if (runtimeDecision.quarantineRef) item.quarantineRef = runtimeDecision.quarantineRef;
  if (runtimeDecision.runId) item.runId = runtimeDecision.runId;
  if (typeof value.materializedRunId === "string") {
    item.status = "materialized";
    item.materializedRunId = value.materializedRunId;
  }
  return item;
}

export function listA2AInbox(params: { cwd: string; includeQuarantine?: boolean }): A2AInboxItem[] {
  ensureA2AStorage(params.cwd);
  const items: A2AInboxItem[] = [];
  const inboxDir = resolveA2APath(params.cwd, "inbox");
  for (const entry of readdirSync(inboxDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    items.push(inboxItemFromRecord(readJson(path.join(inboxDir, entry.name)), ContractValues.Pending));
  }
  if (params.includeQuarantine) {
    const quarantineDir = resolveA2APath(params.cwd, "quarantine");
    for (const entry of readdirSync(quarantineDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".reason.json")) continue;
      items.push(inboxItemFromRecord(readJson(path.join(quarantineDir, entry.name)), "quarantined"));
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
