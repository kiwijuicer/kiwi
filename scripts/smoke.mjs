import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "apps", "cli", "dist", "index.js");
const cwd = mkdtempSync(path.join(tmpdir(), "kiwi-smoke-"));
const kiwiHome = mkdtempSync(path.join(tmpdir(), "kiwi-smoke-home-"));

execFileSync("pnpm", ["build"], {
  cwd: repoRoot,
  encoding: "utf-8",
  stdio: ["ignore", "pipe", "pipe"],
});

function kiwi(args, commandCwd = cwd) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: commandCwd,
    env: { ...process.env, KIWI_HOME: kiwiHome },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function kiwiFails(args, commandCwd = cwd) {
  try {
    kiwi(args, commandCwd);
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  throw new Error(`Expected kiwi ${args.join(" ")} to fail`);
}

kiwi(["init"]);
const planOutput = kiwi(["plan", "# Smoke\n\n## Validate"]);

if (!planOutput.includes("estimated cost:")) {
  throw new Error(`smoke plan output did not include a cost forecast:\n${planOutput}`);
}
const runId = planOutput.match(/runId:\s+(run_[a-z0-9_]+)/)?.[1];

if (!runId) {
  throw new Error(`smoke failed to parse runId from plan output:\n${planOutput}`);
}

kiwi(["status", runId]);
kiwi(["evidence", "manifest", runId]);
kiwi(["operator", "snapshot", runId]);

const manifest = readFileSync(path.join(cwd, ".kiwi", "runs", runId, "final", "evidence-manifest.json"), "utf-8");
const operator = readFileSync(path.join(cwd, ".kiwi", "runs", runId, "operator", "index.html"), "utf-8");

if (!manifest.includes("sha256") || !operator.includes("<!doctype html>")) {
  throw new Error("smoke artifacts are incomplete");
}

const workspace = mkdtempSync(path.join(tmpdir(), "kiwi-workspace-smoke-"));
const apiService = path.join(workspace, "api-service");
const workerService = path.join(workspace, "worker-service");
mkdirSync(apiService);
mkdirSync(workerService);
writeFileSync(path.join(apiService, "core.txt"), "core\n", "utf-8");
writeFileSync(path.join(workerService, "agent.txt"), "agent\n", "utf-8");
execFileSync("git", ["init"], { cwd: apiService, stdio: "ignore" });
execFileSync("git", ["checkout", "-b", "feature/smoke"], { cwd: apiService, stdio: "ignore" });
execFileSync("git", ["add", "core.txt"], { cwd: apiService, stdio: "ignore" });
execFileSync("git", ["-c", "user.name=Kiwi", "-c", "user.email=kiwi@example.com", "commit", "-m", "initial"], {
  cwd: apiService,
  stdio: "ignore",
});
writeFileSync(
  path.join(workspace, "workspace.code-workspace"),
  JSON.stringify({
    folders: [
      { name: "api-service", path: "api-service" },
      { name: "worker-service", path: "worker-service" },
    ],
  }),
  "utf-8",
);

kiwi(["init", "--workspace", workspace]);
const workspaceList = kiwi(["workspace", "list", "--workspace", workspace]);

if (!workspaceList.includes("api-service") || !workspaceList.includes("worker-service")) {
  throw new Error(`workspace smoke did not list sample repos:\n${workspaceList}`);
}
const workspacePlanOutput = kiwi([
  "plan",
  "# Workspace Smoke\n\n## Plan",
  "--workspace",
  workspace,
  "--repo",
  "api-service",
]);
const workspaceRunId = workspacePlanOutput.match(/runId:\s+(run_[a-z0-9_]+)/)?.[1];

if (!workspaceRunId) {
  throw new Error(`workspace smoke failed to parse runId:\n${workspacePlanOutput}`);
}
const maxCostFailure = kiwiFails(["run", workspaceRunId, "--workspace", workspace, "--max-cost", "0.01"]);

if (!maxCostFailure.includes("Estimated run cost")) {
  throw new Error(`workspace smoke max-cost did not fail with forecast detail:\n${maxCostFailure}`);
}
kiwi([
  "run",
  workspaceRunId,
  "--workspace",
  workspace,
  "--command",
  "node -e \"require('fs').writeFileSync('smoke.txt','ok\\\\n')\"",
]);
const diffOutput = kiwi(["diff", workspaceRunId, "--workspace", workspace]);

if (!diffOutput.includes("smoke.txt")) {
  throw new Error(`workspace smoke diff did not include smoke.txt:\n${diffOutput}`);
}
const applyOutput = kiwi(["apply", workspaceRunId, "--workspace", workspace]);

if (!applyOutput.includes("already applied during run")) {
  throw new Error(`workspace smoke apply did not report direct-mode state:\n${applyOutput}`);
}
const tailOutput = kiwi(["tail", workspaceRunId, "--workspace", workspace, "--no-color", "--no-follow"]);

if (!tailOutput.includes("scheduler_routing_decided")) {
  throw new Error(`workspace smoke tail did not include scheduler routing event:\n${tailOutput}`);
}
const workspaceRun = readFileSync(path.join(workspace, ".kiwi", "runs", workspaceRunId, "run.json"), "utf-8");

if (!workspaceRun.includes(`"repoPath": "${apiService}"`)) {
  throw new Error("workspace smoke run did not store target repo metadata");
}
const worktrees = path.join(workspace, ".kiwi", "runs", workspaceRunId, "worktrees");
const remainingWorktrees = existsSync(worktrees) ? readdirSync(worktrees) : [];

if (remainingWorktrees.length !== 0) {
  throw new Error("workspace smoke left attempt worktrees behind");
}
const audit = readFileSync(path.join(workspace, ".kiwi", "logs", "audit.log"), "utf-8");

if (!audit.includes(apiService)) {
  throw new Error("workspace smoke did not record selected repo path");
}
const policy = readFileSync(path.join(kiwiHome, "defaults", "policy.yaml"), "utf-8");

if (!policy.includes("providerPreference")) {
  throw new Error("home default policy did not include providerPreference");
}

console.log(`smoke ok: ${runId}, ${workspaceRunId}`);
