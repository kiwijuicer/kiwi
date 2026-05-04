import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "apps", "cli", "dist", "index.js");
const cwd = mkdtempSync(path.join(tmpdir(), "kiwi-smoke-"));

execFileSync("pnpm", ["build"], {
  cwd: repoRoot,
  encoding: "utf-8",
  stdio: ["ignore", "pipe", "pipe"],
});

function kiwi(args, commandCwd = cwd) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: commandCwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

kiwi(["init"]);
const planOutput = kiwi(["plan", "# Smoke\n\n## Validate"]);
const runId = planOutput.match(/runId:\s+(run_[a-z0-9_]+)/)?.[1];
if (!runId) {
  throw new Error(`smoke failed to parse runId from plan output:\n${planOutput}`);
}

kiwi(["status", runId]);
kiwi(["evidence", "manifest", runId]);
kiwi(["operator", "snapshot", runId]);

const envelope = {
  schemaVersion: "1",
  protocol: "a2a-prep",
  kind: "task_graph",
  payload: {
    planId: "plan_smoke",
    runId,
    initiativeId: "init_smoke",
    summary: "Smoke A2A graph",
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
    messageId: "msg_smoke",
    correlationId: "corr_smoke",
    idempotencyKey: "idempotency-smoke",
    senderAgentId: "smoke-agent",
    recipientAgentId: "kiwi-local",
  },
};
const envelopePath = path.join(cwd, "a2a-envelope.json");
writeFileSync(envelopePath, JSON.stringify(envelope), "utf-8");
const a2aOutput = kiwi(["a2a", "receive", envelopePath, "--loopback", "--trusted-agent", "smoke-agent"]);
if (!a2aOutput.includes("status: accepted")) {
  throw new Error(`smoke A2A receive did not accept envelope:\n${a2aOutput}`);
}

const peerA = mkdtempSync(path.join(tmpdir(), "kiwi-a2a-peer-a-"));
const peerB = mkdtempSync(path.join(tmpdir(), "kiwi-a2a-peer-b-"));
kiwi(["init"], peerA);
kiwi(["init"], peerB);
kiwi(["a2a", "enable", "--local-agent", "agent-a"], peerA);
kiwi(["a2a", "enable", "--local-agent", "agent-b"], peerB);
kiwi(["a2a", "trust", "add", "agent-b", "--inbox-path", path.join(peerB, ".kiwi", "a2a", "transport", "incoming")], peerA);
kiwi(["a2a", "trust", "add", "agent-a", "--inbox-path", path.join(peerA, ".kiwi", "a2a", "transport", "incoming")], peerB);

const peerPlanOutput = kiwi(["plan", "# Peer A2A\n\n## Implement"], peerA);
const peerRunId = peerPlanOutput.match(/runId:\s+(run_[a-z0-9_]+)/)?.[1];
if (!peerRunId) {
  throw new Error(`smoke failed to parse peer runId:\n${peerPlanOutput}`);
}
kiwi([
  "a2a",
  "publish",
  "task_graph",
  "--peer",
  "agent-b",
  "--run-id",
  peerRunId,
  "--correlation-id",
  "corr_peer_smoke",
], peerA);
kiwi(["a2a", "sync"], peerA);
const peerBImport = kiwi(["a2a", "sync"], peerB);
if (!peerBImport.includes("imported: 1")) {
  throw new Error(`smoke A2A task graph import failed:\n${peerBImport}`);
}

const reviewPlanOutput = kiwi(["plan", "# Peer Review\n\n## Review"], peerB);
const reviewRunId = reviewPlanOutput.match(/runId:\s+(run_[a-z0-9_]+)/)?.[1];
if (!reviewRunId) {
  throw new Error(`smoke failed to parse review runId:\n${reviewPlanOutput}`);
}
const reviewAttemptOutput = kiwi(["attempt", reviewRunId, "step_001"], peerB);
const reviewAttemptId = reviewAttemptOutput.match(/attemptId:\s+(attempt_[a-z0-9_]+)/)?.[1];
if (!reviewAttemptId) {
  throw new Error(`smoke failed to parse review attemptId:\n${reviewAttemptOutput}`);
}
kiwi([
  "a2a",
  "publish",
  "review_verdict",
  "--peer",
  "agent-a",
  "--run-id",
  reviewRunId,
  "--step-id",
  "step_001",
  "--attempt-id",
  reviewAttemptId,
  "--correlation-id",
  "corr_peer_smoke",
], peerB);
kiwi(["a2a", "sync"], peerB);
const peerAReply = kiwi(["a2a", "sync"], peerA);
if (!peerAReply.includes("imported: 1")) {
  throw new Error(`smoke A2A review reply import failed:\n${peerAReply}`);
}
if (!existsSync(path.join(peerA, ".kiwi", "a2a", "ledger", "correlations", "corr_peer_smoke"))) {
  throw new Error("smoke A2A correlation ledger was not written");
}

const manifest = readFileSync(
  path.join(cwd, ".kiwi", "runs", runId, "final", "evidence-manifest.json"),
  "utf-8",
);
const operator = readFileSync(
  path.join(cwd, ".kiwi", "runs", runId, "operator", "index.html"),
  "utf-8",
);
if (!manifest.includes("sha256") || !operator.includes("<!doctype html>")) {
  throw new Error("smoke artifacts are incomplete");
}

const workspace = mkdtempSync(path.join(tmpdir(), "kiwi-voice-smoke-"));
const voiceCore = path.join(workspace, "voice-core");
const voiceAgent = path.join(workspace, "voice-livekit-agent");
mkdirSync(voiceCore);
mkdirSync(voiceAgent);
writeFileSync(path.join(voiceCore, "core.txt"), "core\n", "utf-8");
writeFileSync(path.join(voiceAgent, "agent.txt"), "agent\n", "utf-8");
writeFileSync(
  path.join(workspace, "workspace.code-workspace"),
  JSON.stringify({
    folders: [
      { name: "voice-core", path: "voice-core" },
      { name: "voice-livekit-agent", path: "voice-livekit-agent" },
    ],
  }),
  "utf-8",
);

kiwi(["init", "--workspace", workspace]);
const workspaceList = kiwi(["workspace", "list", "--workspace", workspace]);
if (!workspaceList.includes("voice-core") || !workspaceList.includes("voice-livekit-agent")) {
  throw new Error(`workspace smoke did not list voice repos:\n${workspaceList}`);
}
const workspacePlanOutput = kiwi([
  "plan",
  "# Workspace Smoke\n\n## Plan",
  "--workspace",
  workspace,
  "--repo",
  "voice-core",
]);
const workspaceRunId = workspacePlanOutput.match(/runId:\s+(run_[a-z0-9_]+)/)?.[1];
if (!workspaceRunId) {
  throw new Error(`workspace smoke failed to parse runId:\n${workspacePlanOutput}`);
}
kiwi(["run", workspaceRunId, "--workspace", workspace, "--command", "node -e 0"]);
const workspaceRun = readFileSync(
  path.join(workspace, ".kiwi", "runs", workspaceRunId, "run.json"),
  "utf-8",
);
if (!workspaceRun.includes(`"repoPath": "${voiceCore}"`)) {
  throw new Error("workspace smoke run did not store target repo metadata");
}
const worktrees = path.join(workspace, ".kiwi", "runs", workspaceRunId, "worktrees");
const firstWorktree = path.join(worktrees, readdirSync(worktrees)[0]);
if (!existsSync(path.join(firstWorktree, "core.txt")) || existsSync(path.join(firstWorktree, "voice-livekit-agent"))) {
  throw new Error("workspace smoke sandbox did not isolate the selected repo");
}

console.log(`smoke ok: ${runId}, ${workspaceRunId}`);
