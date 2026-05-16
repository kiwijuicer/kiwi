import { ProtocolEnvelopeKindSchema } from "@kiwi/contracts";
import {
  acceptA2AHandoff,
  addA2ATrustedPeer,
  handleA2AEnvelope,
  listA2AInbox,
  loadA2AConfig,
  publishA2AEnvelope,
  removeA2ATrustedPeer,
  setA2AEnabled,
  syncA2AFilesystem,
} from "@kiwi/a2a";
import { workspaceArgs } from "./workspace";

function a2aConfigTool(args: Record<string, unknown>, workspacePath: string): unknown {
  if (typeof args.enabled === "boolean" || typeof args.localAgentId === "string") {
    const configParams: Parameters<typeof setA2AEnabled>[0] = {
      cwd: workspacePath,
      enabled: typeof args.enabled === "boolean" ? args.enabled : loadA2AConfig(workspacePath).enabled,
    };
    if (typeof args.localAgentId === "string") configParams.localAgentId = args.localAgentId;
    return setA2AEnabled(configParams);
  }
  return loadA2AConfig(workspacePath);
}

function publishA2ATool(args: Record<string, unknown>, workspacePath: string): unknown {
  const publishParams: Parameters<typeof publishA2AEnvelope>[0] = {
    cwd: workspacePath,
    peerAgentId: String(args.peerAgentId ?? args.peer ?? ""),
    kind: ProtocolEnvelopeKindSchema.parse(args.kind),
  };
  if (typeof args.runId === "string") publishParams.runId = args.runId;
  if (typeof args.stepId === "string") publishParams.stepId = args.stepId;
  if (typeof args.attemptId === "string") publishParams.attemptId = args.attemptId;
  if (typeof args.gateId === "string") publishParams.gateId = args.gateId;
  if (typeof args.artifactRef === "string") publishParams.artifactRef = args.artifactRef;
  if (typeof args.correlationId === "string") publishParams.correlationId = args.correlationId;
  if (typeof args.idempotencyKey === "string") publishParams.idempotencyKey = args.idempotencyKey;
  if (args.payload !== undefined) publishParams.payload = args.payload;
  return publishA2AEnvelope(publishParams);
}

export function callA2ATool(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
  workspacePath: string,
): Promise<unknown> | unknown | undefined {
  switch (name) {
    case "kiwi_a2a_receive":
      return handleA2AEnvelope({
        cwd: workspacePath,
        envelope: args.envelope,
        policy: {
          mode: args.loopback === true ? "loopback" : "disabled",
          localAgentId: typeof args.localAgentId === "string" ? args.localAgentId : "kiwi-local",
          trustedAgentIds: Array.isArray(args.trustedAgentIds)
            ? args.trustedAgentIds.filter((entry): entry is string => typeof entry === "string")
            : [],
        },
      }).decision;
    case "kiwi_a2a_config":
      return a2aConfigTool(args, workspacePath);
    case "kiwi_a2a_trust_add":
      return addA2ATrustedPeer({
        cwd: workspacePath,
        agentId: String(args.agentId ?? ""),
        inboxPath: String(args.inboxPath ?? ""),
        allowRemotePatches: args.allowRemotePatches === true,
      });
    case "kiwi_a2a_trust_list":
      return loadA2AConfig(workspacePath).peers;
    case "kiwi_a2a_trust_remove":
      return removeA2ATrustedPeer({
        cwd: workspacePath,
        agentId: String(args.agentId ?? ""),
      });
    case "kiwi_a2a_publish":
      return publishA2ATool(args, workspacePath);
    case "kiwi_a2a_sync":
      return syncA2AFilesystem({ cwd: workspacePath });
    case "kiwi_a2a_inbox":
      return listA2AInbox({ cwd: workspacePath, includeQuarantine: true });
    case "kiwi_a2a_accept": {
      const acceptWorkspace = workspaceArgs(args, cwd, true);
      const repo = acceptWorkspace.repo!;
      return acceptA2AHandoff({
        cwd: acceptWorkspace.workspacePath,
        messageId: String(args.messageId ?? ""),
        workspacePath: acceptWorkspace.workspacePath,
        repoId: repo.id,
        repoPath: repo.path,
      });
    }
    default:
      return undefined;
  }
}
