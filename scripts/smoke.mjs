import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

function kiwi(args) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
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
    recipientAgentId: "ai-kiwi-local",
  },
};
const envelopePath = path.join(cwd, "a2a-envelope.json");
writeFileSync(envelopePath, JSON.stringify(envelope), "utf-8");
const a2aOutput = kiwi(["a2a", "receive", envelopePath, "--loopback", "--trusted-agent", "smoke-agent"]);
if (!a2aOutput.includes("status: accepted")) {
  throw new Error(`smoke A2A receive did not accept envelope:\n${a2aOutput}`);
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

console.log(`smoke ok: ${runId}`);
