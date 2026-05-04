import { existsSync, readFileSync } from "fs";
import path from "path";
import chalk from "chalk";
import { Artifact, ProtocolEnvelopeKind, ProtocolEnvelopeKindSchema } from "@kiwi/contracts";
import {
  acceptA2AHandoff,
  addA2ATrustedPeer,
  ensureA2AStorage,
  handleA2AEnvelope,
  listA2AInbox,
  loadA2AConfig,
  publishA2AEnvelope,
  removeA2ATrustedPeer,
  setA2AEnabled,
  syncA2AFilesystem,
} from "@kiwi/core";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";

export interface A2AReceiveOptions extends CliWorkspaceOptions {
  loopback?: boolean;
  localAgent?: string;
  trustedAgent?: string;
  now?: Date;
}

export interface A2AEnableOptions extends CliWorkspaceOptions {
  localAgent?: string;
}

export interface A2ATrustAddOptions extends CliWorkspaceOptions {
  inboxPath: string;
  allowRemotePatches?: boolean;
}

export interface A2APublishOptions extends CliWorkspaceOptions {
  peer: string;
  runId?: string;
  stepId?: string;
  attemptId?: string;
  gateId?: string;
  artifactRef?: string;
  artifactType?: Artifact["type"];
  correlationId?: string;
  idempotencyKey?: string;
}

function readEnvelope(value: string, cwd: string): unknown {
  const target = path.isAbsolute(value) ? value : path.join(cwd, value);
  const raw = existsSync(target) ? readFileSync(target, "utf-8") : value;
  return JSON.parse(raw) as unknown;
}

function trustedAgents(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseKind(value: string): ProtocolEnvelopeKind {
  return ProtocolEnvelopeKindSchema.parse(value);
}

function a2aIncomingPath(workspacePath: string): string {
  return path.join(workspacePath, ".kiwi", "a2a", "transport", "incoming");
}

export async function runA2AReceive(
  envelopeInput: string,
  opts: A2AReceiveOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const result = handleA2AEnvelope({
    cwd: workspace.workspacePath,
    envelope: readEnvelope(envelopeInput, cwd),
    now: opts.now,
    policy: {
      mode: opts.loopback ? "loopback" : "disabled",
      localAgentId: opts.localAgent ?? "kiwi-local",
      trustedAgentIds: trustedAgents(opts.trustedAgent),
    },
  });

  const mark = result.decision.status === "accepted" ? chalk.green("✓") : chalk.yellow("•");
  console.log(mark + " A2A envelope handled");
  console.log(chalk.dim(`status: ${result.decision.status}`));
  console.log(chalk.dim(`reason: ${result.decision.reason}`));
  if (result.decision.runId) console.log(chalk.dim(`runId: ${result.decision.runId}`));
  if (result.decision.inboxRef) console.log(chalk.dim(`inbox: .kiwi/a2a/${result.decision.inboxRef}`));
  if (result.decision.quarantineRef) {
    console.log(chalk.dim(`quarantine: .kiwi/a2a/${result.decision.quarantineRef}`));
  }
}

export async function runA2AEnable(opts: A2AEnableOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const enableParams: Parameters<typeof setA2AEnabled>[0] = {
    cwd: workspace.workspacePath,
    enabled: true,
  };
  if (opts.localAgent) enableParams.localAgentId = opts.localAgent;
  const config = setA2AEnabled(enableParams);
  console.log(chalk.green("✓") + " A2A enabled");
  console.log(chalk.dim(`localAgentId: ${config.localAgentId}`));
  console.log(chalk.dim(`incoming: ${a2aIncomingPath(workspace.workspacePath)}`));
}

export async function runA2ADisable(opts: CliWorkspaceOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  setA2AEnabled({ cwd: workspace.workspacePath, enabled: false });
  console.log(chalk.green("✓") + " A2A disabled");
}

export async function runA2AIdentity(opts: CliWorkspaceOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  ensureA2AStorage(workspace.workspacePath);
  const config = loadA2AConfig(workspace.workspacePath);
  console.log(`enabled: ${config.enabled}`);
  console.log(`localAgentId: ${config.localAgentId}`);
  console.log(`incoming: ${a2aIncomingPath(workspace.workspacePath)}`);
  console.log(`trustedPeers: ${config.peers.length}`);
}

export async function runA2ATrustAdd(
  agentId: string,
  opts: A2ATrustAddOptions,
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const trustParams: Parameters<typeof addA2ATrustedPeer>[0] = {
    cwd: workspace.workspacePath,
    agentId,
    inboxPath: opts.inboxPath,
  };
  if (opts.allowRemotePatches !== undefined) trustParams.allowRemotePatches = opts.allowRemotePatches;
  const config = addA2ATrustedPeer(trustParams);
  const peer = config.peers.find((entry) => entry.agentId === agentId);
  console.log(chalk.green("✓") + " A2A trusted peer saved");
  console.log(chalk.dim(`agentId: ${agentId}`));
  if (peer) console.log(chalk.dim(`inboxPath: ${peer.inboxPath}`));
}

export async function runA2ATrustList(opts: CliWorkspaceOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const config = loadA2AConfig(workspace.workspacePath);
  if (config.peers.length === 0) {
    console.log("No trusted A2A peers configured");
    return;
  }
  for (const peer of config.peers) {
    console.log(`${peer.agentId}\t${peer.inboxPath}\tallowRemotePatches=${peer.allowRemotePatches}`);
  }
}

export async function runA2ATrustRemove(
  agentId: string,
  opts: CliWorkspaceOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  removeA2ATrustedPeer({ cwd: workspace.workspacePath, agentId });
  console.log(chalk.green("✓") + " A2A trusted peer removed");
}

export async function runA2APublish(
  kindInput: string,
  opts: A2APublishOptions,
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const publishParams: Parameters<typeof publishA2AEnvelope>[0] = {
    cwd: workspace.workspacePath,
    peerAgentId: opts.peer,
    kind: parseKind(kindInput),
  };
  if (opts.runId) publishParams.runId = opts.runId;
  if (opts.stepId) publishParams.stepId = opts.stepId;
  if (opts.attemptId) publishParams.attemptId = opts.attemptId;
  if (opts.gateId) publishParams.gateId = opts.gateId;
  if (opts.artifactRef) publishParams.artifactRef = opts.artifactRef;
  if (opts.artifactType) publishParams.artifactType = opts.artifactType;
  if (opts.correlationId) publishParams.correlationId = opts.correlationId;
  if (opts.idempotencyKey) publishParams.idempotencyKey = opts.idempotencyKey;
  const result = publishA2AEnvelope(publishParams);
  console.log(chalk.green("✓") + " A2A envelope queued");
  console.log(chalk.dim(`messageId: ${result.envelope.a2a?.messageId}`));
  console.log(chalk.dim(`outbox: .kiwi/a2a/${result.outboxRef}`));
}

export async function runA2ASync(opts: CliWorkspaceOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const result = syncA2AFilesystem({ cwd: workspace.workspacePath });
  console.log(chalk.green("✓") + " A2A sync complete");
  console.log(chalk.dim(`delivered: ${result.delivered.length}`));
  console.log(chalk.dim(`imported: ${result.imported.length}`));
  console.log(chalk.dim(`blocked: ${result.blocked.length}`));
  console.log(chalk.dim(`duplicates: ${result.duplicates.length}`));
  console.log(chalk.dim(`quarantined: ${result.quarantined.length}`));
}

export async function runA2AInbox(opts: CliWorkspaceOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const items = listA2AInbox({ cwd: workspace.workspacePath, includeQuarantine: true });
  if (items.length === 0) {
    console.log("A2A inbox is empty");
    return;
  }
  for (const item of items) {
    const run = item.materializedRunId ? ` runId=${item.materializedRunId}` : "";
    console.log(`${item.messageId}\t${item.kind}\t${item.status}\tfrom=${item.senderAgentId}${run}`);
  }
}

export async function runA2AAccept(
  messageId: string,
  opts: CliWorkspaceOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, true);
  const repo = workspace.repo!;
  const result = acceptA2AHandoff({
    cwd: workspace.workspacePath,
    messageId,
    workspacePath: workspace.workspacePath,
    repoId: repo.id,
    repoPath: repo.path,
  });
  console.log(chalk.green("✓") + " A2A initiative accepted");
  console.log(chalk.dim(`runId: ${result.runId}`));
  console.log(chalk.dim(`title: ${result.initiative.title}`));
}
