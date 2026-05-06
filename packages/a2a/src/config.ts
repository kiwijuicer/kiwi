import { mkdirSync } from "fs";
import path from "path";
import { A2AConfig, A2ATrustedPeer } from "@kiwi/contracts";
import { loadKiwiConfig, saveKiwiConfig } from "@kiwi/core";
import { A2ARuntimePolicy, configPath, resolveA2APath } from "./common";

export function ensureA2AStorage(cwd: string): void {
  for (const ref of [
    "transport/incoming",
    "inbox",
    "idempotency",
    "ledger",
    "ledger/outbox",
    "ledger/imported",
    "ledger/blocked",
    "ledger/duplicates",
    "ledger/correlations",
    "attachments",
    "quarantine",
  ]) {
    mkdirSync(resolveA2APath(cwd, ref), { recursive: true });
  }
}

export function loadA2AConfig(cwd: string): A2AConfig {
  return loadKiwiConfig(configPath(cwd)).a2a;
}

export function saveA2AConfig(cwd: string, a2a: A2AConfig): A2AConfig {
  const current = loadKiwiConfig(configPath(cwd));
  return saveKiwiConfig(configPath(cwd), { ...current, a2a }).a2a;
}

export function setA2AEnabled(params: { cwd: string; enabled: boolean; localAgentId?: string }): A2AConfig {
  ensureA2AStorage(params.cwd);
  const current = loadA2AConfig(params.cwd);
  return saveA2AConfig(params.cwd, {
    ...current,
    enabled: params.enabled,
    localAgentId: params.localAgentId ?? current.localAgentId,
  });
}

export function addA2ATrustedPeer(params: {
  cwd: string;
  agentId: string;
  inboxPath: string;
  allowRemotePatches?: boolean;
}): A2AConfig {
  ensureA2AStorage(params.cwd);
  const current = loadA2AConfig(params.cwd);
  const nextPeer = {
    agentId: params.agentId,
    inboxPath: path.isAbsolute(params.inboxPath) ? params.inboxPath : path.resolve(params.cwd, params.inboxPath),
    allowRemotePatches: params.allowRemotePatches ?? false,
  };
  return saveA2AConfig(params.cwd, {
    ...current,
    peers: [...current.peers.filter((peer) => peer.agentId !== params.agentId), nextPeer],
  });
}

export function removeA2ATrustedPeer(params: { cwd: string; agentId: string }): A2AConfig {
  const current = loadA2AConfig(params.cwd);
  return saveA2AConfig(params.cwd, {
    ...current,
    peers: current.peers.filter((peer) => peer.agentId !== params.agentId),
  });
}

export function a2aPolicyFromConfig(config: A2AConfig): A2ARuntimePolicy {
  return {
    mode: config.enabled ? "filesystem" : "disabled",
    localAgentId: config.localAgentId,
    trustedAgentIds: config.peers.map((peer) => peer.agentId),
    trustedPeers: config.peers,
    acceptedKinds: config.acceptedKinds,
  };
}

export function requireEnabledConfig(cwd: string): A2AConfig {
  const config = loadA2AConfig(cwd);
  if (!config.enabled) {
    throw new Error("A2A filesystem runtime is disabled");
  }
  return config;
}

export function requirePeer(config: A2AConfig, peerAgentId: string): A2ATrustedPeer {
  const peer = config.peers.find((entry) => entry.agentId === peerAgentId);
  if (!peer) {
    throw new Error(`A2A peer is not trusted: ${peerAgentId}`);
  }
  return peer;
}
