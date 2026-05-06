import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Initiative, ProtocolEnvelope } from "@kiwi/contracts";
import { readAuditEvents } from "../cost-ledger";
import { kiwiPolicyPath } from "../config";
import {
  acceptA2AHandoff,
  addA2ATrustedPeer,
  handleA2AEnvelope,
  importA2AIncoming,
  listA2AInbox,
  publishA2AEnvelope,
  setA2AEnabled,
  syncA2AFilesystem,
} from "../a2a-runtime";
import { loadInitiative } from "../run-store";

function cwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-a2a-"));
}

function writePolicy(repo: string): void {
  writeFileSync(
    kiwiPolicyPath(repo),
    `version: "1"
project:
  name: kiwi
  language: typescript
  packageManager: pnpm
commands:
  test: node -e 0
  lint: node -e 0
  typecheck: node -e 0
routing:
  defaultAgentRole: executor
  defaultModelCapability: mid
  stepTypeOverrides: {}
riskZones:
  high: []
approvals:
  requireFor: []
  commandApprovalStates: {}
`,
    "utf-8",
  );
}

function setupRepo(agentId: string): string {
  const repo = cwd();
  mkdirSync(path.join(repo, ".kiwi", "runs"), { recursive: true });
  mkdirSync(path.join(repo, ".kiwi", "logs"), { recursive: true });
  writeFileSync(
    path.join(repo, ".kiwi", "config.yaml"),
    `version: "1"
initializedAt: "2026-05-04T12:00:00.000Z"
a2a:
  enabled: false
  localAgentId: ${agentId}
  acceptedKinds: [initiative, task_graph, step_attempt, gate_result, review_verdict, artifact]
  peers: []
`,
    "utf-8",
  );
  writePolicy(repo);
  return repo;
}

function incoming(repo: string): string {
  return path.join(repo, ".kiwi", "a2a", "transport", "incoming");
}

function remoteInitiative(): Initiative {
  return {
    id: "init_remote",
    title: "Remote ticket",
    rawInput: "# Remote ticket\n\n## Implement",
    source: "cli",
    repoPath: "/remote/repo",
    riskProfile: "dev",
    budgetProfile: "normal",
    createdAt: "2026-05-04T12:00:00.000Z",
  };
}

function taskGraphEnvelope(overrides: Partial<ProtocolEnvelope["a2a"]> = {}): ProtocolEnvelope {
  return {
    schemaVersion: "1",
    protocol: "a2a-prep",
    kind: "task_graph",
    payload: {
      planId: "plan_demo",
      runId: "run_demo",
      initiativeId: "init_demo",
      summary: "Remote graph",
      steps: [
        {
          stepId: "step_001",
          type: "planning",
          title: "Plan",
          dependsOn: [],
          successCriteria: ["Done"],
          requiredGates: [],
          recommendedAgentRole: "planner",
          recommendedModelCapability: "frontier",
          status: "pending",
        },
      ],
      acceptanceCriteria: ["Done"],
      assumptions: [],
      openQuestions: [],
      riskScore: 2,
      complexityScore: 1,
      createdAt: "2026-05-04T12:00:00.000Z",
    },
    createdAt: "2026-05-04T12:00:00.000Z",
    a2a: {
      messageId: "msg_demo",
      correlationId: "corr_demo",
      idempotencyKey: "idempotency-demo",
      senderAgentId: "remote-agent",
      recipientAgentId: "kiwi-local",
      ...overrides,
    },
  };
}

describe("A2A runtime", () => {
  it("is disabled by default", () => {
    const repo = cwd();
    const result = handleA2AEnvelope({
      cwd: repo,
      envelope: taskGraphEnvelope(),
      now: new Date("2026-05-04T12:01:00.000Z"),
    });

    expect(result.decision.status).toBe("blocked");
    expect(result.decision.reason).toContain("disabled");
    expect(existsSync(path.join(repo, ".kiwi", "a2a", "inbox", "msg_demo.json"))).toBe(false);
  });

  it("accepts trusted loopback envelopes once and detects replays", () => {
    const repo = cwd();
    const envelope = taskGraphEnvelope();

    const accepted = handleA2AEnvelope({
      cwd: repo,
      envelope,
      policy: {
        mode: "loopback",
        trustedAgentIds: ["remote-agent"],
      },
      now: new Date("2026-05-04T12:02:00.000Z"),
    });
    expect(accepted.decision.status).toBe("accepted");
    expect(accepted.decision.runId).toBe("run_demo");
    expect(existsSync(path.join(repo, ".kiwi", "a2a", "inbox", "msg_demo.json"))).toBe(true);

    const duplicate = handleA2AEnvelope({
      cwd: repo,
      envelope,
      policy: {
        mode: "loopback",
        trustedAgentIds: ["remote-agent"],
      },
      now: new Date("2026-05-04T12:03:00.000Z"),
    });
    expect(duplicate.decision.status).toBe("duplicate");
    expect(duplicate.decision.duplicateOfRef).toContain("idempotency");

    const events = readAuditEvents(repo, "run_demo");
    expect(events.some((event) => event.eventType === "a2a_runtime_event")).toBe(true);
  });

  it("blocks untrusted senders and remote patch artifacts", () => {
    const repo = cwd();
    const untrusted = handleA2AEnvelope({
      cwd: repo,
      envelope: taskGraphEnvelope({ senderAgentId: "unknown-agent" }),
      policy: {
        mode: "loopback",
        trustedAgentIds: ["remote-agent"],
      },
      now: new Date("2026-05-04T12:04:00.000Z"),
    });
    expect(untrusted.decision.status).toBe("blocked");
    expect(untrusted.decision.reason).toContain("not trusted");

    const patchEnvelope: ProtocolEnvelope = {
      schemaVersion: "1",
      protocol: "a2a-prep",
      kind: "artifact",
      payload: {
        type: "patch",
        ref: "remote.patch",
        createdAt: "2026-05-04T12:00:00.000Z",
      },
      createdAt: "2026-05-04T12:00:00.000Z",
      a2a: {
        messageId: "msg_patch",
        correlationId: "corr_patch",
        idempotencyKey: "idempotency-patch",
        senderAgentId: "remote-agent",
        recipientAgentId: "kiwi-local",
      },
    };
    const patch = handleA2AEnvelope({
      cwd: repo,
      envelope: patchEnvelope,
      policy: {
        mode: "loopback",
        trustedAgentIds: ["remote-agent"],
      },
      now: new Date("2026-05-04T12:05:00.000Z"),
    });
    expect(patch.decision.status).toBe("blocked");
    expect(patch.decision.reason).toContain("Remote patch");
  });

  it("delivers filesystem handoffs between trusted kiwi peers and materializes initiatives", () => {
    const a = setupRepo("agent-a");
    const b = setupRepo("agent-b");
    setA2AEnabled({ cwd: a, enabled: true });
    setA2AEnabled({ cwd: b, enabled: true });
    addA2ATrustedPeer({ cwd: a, agentId: "agent-b", inboxPath: incoming(b) });
    addA2ATrustedPeer({ cwd: b, agentId: "agent-a", inboxPath: incoming(a) });

    const queued = publishA2AEnvelope({
      cwd: a,
      peerAgentId: "agent-b",
      kind: "initiative",
      payload: remoteInitiative(),
      now: new Date("2026-05-04T12:06:00.000Z"),
    });
    expect(queued.envelope.a2a?.recipientAgentId).toBe("agent-b");

    const delivered = syncA2AFilesystem({ cwd: a, now: new Date("2026-05-04T12:07:00.000Z") });
    expect(delivered.delivered).toHaveLength(1);
    expect(existsSync(path.join(incoming(b), `${queued.envelope.a2a?.messageId}.json`))).toBe(true);

    const imported = syncA2AFilesystem({ cwd: b, now: new Date("2026-05-04T12:08:00.000Z") });
    expect(imported.imported[0]?.decision.status).toBe("accepted");
    expect(listA2AInbox({ cwd: b })[0]?.status).toBe("pending");

    const accepted = acceptA2AHandoff({
      cwd: b,
      messageId: queued.envelope.a2a!.messageId,
      workspacePath: b,
      repoPath: b,
      now: new Date("2026-05-04T12:09:00.000Z"),
    });
    const local = loadInitiative(accepted.runId, b);
    expect(local.source).toBe("a2a");
    expect(local.rawInput).toContain("Remote ticket");
    expect(listA2AInbox({ cwd: b })[0]?.materializedRunId).toBe(accepted.runId);
  });

  it("blocks disabled filesystem imports, corrupted envelopes, and bad attachment hashes", () => {
    const b = setupRepo("agent-b");
    mkdirSync(incoming(b), { recursive: true });
    writeFileSync(
      path.join(incoming(b), "msg_disabled.json"),
      JSON.stringify(
        taskGraphEnvelope({
          messageId: "msg_disabled",
          correlationId: "corr_disabled",
          idempotencyKey: "idempotency-disabled",
          senderAgentId: "agent-a",
          recipientAgentId: "agent-b",
        }),
      ),
      "utf-8",
    );

    const disabled = importA2AIncoming({ cwd: b, now: new Date("2026-05-04T12:10:00.000Z") });
    expect(disabled.blocked[0]?.decision.reason).toContain("disabled");

    setA2AEnabled({ cwd: b, enabled: true });
    addA2ATrustedPeer({ cwd: b, agentId: "agent-a", inboxPath: incoming(setupRepo("agent-a")) });
    writeFileSync(path.join(incoming(b), "broken.json"), "{", "utf-8");
    const corrupt = importA2AIncoming({ cwd: b, now: new Date("2026-05-04T12:11:00.000Z") });
    expect(corrupt.quarantined[0]).toContain("corrupt");

    const attachmentDir = path.join(incoming(b), "attachments", "msg_bad_hash");
    mkdirSync(attachmentDir, { recursive: true });
    writeFileSync(path.join(attachmentDir, "note.txt"), "real", "utf-8");
    const badHashEnvelope: ProtocolEnvelope = {
      ...taskGraphEnvelope({
        messageId: "msg_bad_hash",
        correlationId: "corr_bad_hash",
        idempotencyKey: "idempotency-bad-hash",
        senderAgentId: "agent-a",
        recipientAgentId: "agent-b",
      }),
      a2a: {
        messageId: "msg_bad_hash",
        correlationId: "corr_bad_hash",
        idempotencyKey: "idempotency-bad-hash",
        senderAgentId: "agent-a",
        recipientAgentId: "agent-b",
        attachments: [
          {
            ref: "attachments/msg_bad_hash/note.txt",
            sha256: "0".repeat(64),
            bytes: 4,
            mediaType: "text/plain",
          },
        ],
      },
    };
    writeFileSync(path.join(incoming(b), "msg_bad_hash.json"), JSON.stringify(badHashEnvelope), "utf-8");
    const badHash = importA2AIncoming({ cwd: b, now: new Date("2026-05-04T12:12:00.000Z") });
    expect(badHash.blocked[0]?.decision.reason).toContain("hash mismatch");
  });

  it("quarantines trusted filesystem patch artifacts without applying them", () => {
    const b = setupRepo("agent-b");
    setA2AEnabled({ cwd: b, enabled: true });
    addA2ATrustedPeer({ cwd: b, agentId: "agent-a", inboxPath: incoming(setupRepo("agent-a")) });
    const attachmentDir = path.join(incoming(b), "attachments", "msg_patch_fs");
    mkdirSync(attachmentDir, { recursive: true });
    const patchPath = path.join(attachmentDir, "diff.patch");
    writeFileSync(patchPath, "diff --git a/a b/a\n", "utf-8");
    const patchContent = readFileSync(patchPath);
    const patchEnvelope: ProtocolEnvelope = {
      schemaVersion: "1",
      protocol: "a2a-prep",
      kind: "artifact",
      payload: {
        type: "patch",
        ref: "remote.patch",
        createdAt: "2026-05-04T12:00:00.000Z",
      },
      createdAt: "2026-05-04T12:00:00.000Z",
      a2a: {
        messageId: "msg_patch_fs",
        correlationId: "corr_patch_fs",
        idempotencyKey: "idempotency-patch-fs",
        senderAgentId: "agent-a",
        recipientAgentId: "agent-b",
        attachments: [
          {
            ref: "attachments/msg_patch_fs/diff.patch",
            sha256: createHash("sha256").update(patchContent).digest("hex"),
            bytes: patchContent.byteLength,
            mediaType: "text/x-patch",
          },
        ],
      },
    };
    writeFileSync(path.join(incoming(b), "msg_patch_fs.json"), JSON.stringify(patchEnvelope), "utf-8");

    const imported = importA2AIncoming({ cwd: b, now: new Date("2026-05-04T12:13:00.000Z") });
    expect(imported.imported[0]?.decision.status).toBe("accepted");
    expect(imported.quarantined[0]).toBe("quarantine/msg_patch_fs.json");
    expect(existsSync(path.join(b, ".kiwi", "a2a", "quarantine", "msg_patch_fs.json"))).toBe(true);
    expect(existsSync(path.join(b, "remote.patch"))).toBe(false);
    expect(listA2AInbox({ cwd: b, includeQuarantine: true })[0]?.status).toBe("quarantined");
  });
});
