import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { kiwiModelRegistryPath, kiwiPolicyPath } from "@kiwi/core";
import { handleMcpRequest } from "../index";

function setupRepo(): string {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-mcp-ux-"));
  mkdirSync(path.join(cwd, ".kiwi", "runs"), { recursive: true });
  mkdirSync(path.join(cwd, ".kiwi", "logs"), { recursive: true });
  writeFileSync(path.join(cwd, ".kiwi", "config.yaml"), 'version: "1"\n', "utf-8");
  writeFileSync(
    kiwiPolicyPath(cwd),
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
commandProfiles:
  default:
    allowedCommands: [node]
    approvalState: auto
    approvalRequiredPaths: []
    deniedPaths: []
    envAllowlist: [PATH]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 1000
    maxOutputBytes: 4096
`,
    "utf-8",
  );
  writeFileSync(
    kiwiModelRegistryPath(cwd),
    `version: "1"
models:
  - id: stub-frontier
    provider: stub
    capability: frontier
    roles: [planner, reviewer]
    enabled: true
`,
    "utf-8",
  );
  return cwd;
}

function toolJson(response: Awaited<ReturnType<typeof handleMcpRequest>>): unknown {
  const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
  return JSON.parse(text) as unknown;
}

async function planRun(cwd: string): Promise<string> {
  const planned = await handleMcpRequest(
    {
      id: 1,
      method: "tools/call",
      params: {
        name: "kiwi_plan",
        arguments: { rawInput: "# UX Safety\n\n## Validate", allowStub: true },
      },
    },
    cwd,
  );
  expect(planned.error).toBeUndefined();
  return (toolJson(planned) as { runId: string }).runId;
}

async function previewRun(cwd: string, runId: string): Promise<string> {
  const preview = await handleMcpRequest(
    {
      id: 2,
      method: "tools/call",
      params: {
        name: "kiwi_preview_run",
        arguments: { runId },
      },
    },
    cwd,
  );
  expect(preview.error).toBeUndefined();
  return (toolJson(preview) as { previewToken: string }).previewToken;
}

describe("MCP UX safety tools", () => {
  it("lists doctor and next tools while keeping A2A hidden by default", async () => {
    const tools = await handleMcpRequest({ id: 1, method: "tools/list" }, setupRepo());
    const payload = JSON.stringify(tools.result);
    expect(payload).toContain("kiwi_doctor");
    expect(payload).toContain("kiwi_next");
    expect(payload).toContain("READ_ONLY");
    expect(payload).not.toContain("kiwi_a2a_receive");
  });

  it("returns doctor diagnostics for initialized, dirty, and missing workspaces", async () => {
    const previousFake = process.env.KIWI_FAKE_BINARY_AVAILABLE;
    process.env.KIWI_FAKE_BINARY_AVAILABLE = "1";
    try {
      const cwd = setupRepo();
      writeFileSync(path.join(cwd, ".gitignore"), ".kiwi/\n", "utf-8");
      execFileSync("git", ["init"], { cwd, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "kiwi@example.test"], { cwd, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "kiwi"], { cwd, stdio: "ignore" });
      execFileSync("git", ["add", ".gitignore"], { cwd, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });
      writeFileSync(path.join(cwd, "dirty.txt"), "dirty\n", "utf-8");

      const doctor = await handleMcpRequest(
        { id: 1, method: "tools/call", params: { name: "kiwi_doctor", arguments: { workspacePath: cwd } } },
        os.tmpdir(),
      );
      expect(doctor.error).toBeUndefined();
      const parsed = toolJson(doctor) as { safeToPlan: boolean; safeToRun: boolean; git: { dirtyFiles: number } };
      expect(parsed.safeToPlan).toBe(true);
      expect(parsed.safeToRun).toBe(false);
      expect(parsed.git.dirtyFiles).toBeGreaterThan(0);

      const missing = mkdtempSync(path.join(os.tmpdir(), "kiwi-mcp-missing-"));
      const missingDoctor = await handleMcpRequest(
        { id: 2, method: "tools/call", params: { name: "kiwi_doctor", arguments: { workspacePath: missing } } },
        os.tmpdir(),
      );
      const missingParsed = toolJson(missingDoctor) as { safeToPlan: boolean; warnings: string[] };
      expect(missingParsed.safeToPlan).toBe(false);
      expect(missingParsed.warnings).toContain("workspace is not initialized");
    } finally {
      if (previousFake === undefined) delete process.env.KIWI_FAKE_BINARY_AVAILABLE;
      else process.env.KIWI_FAKE_BINARY_AVAILABLE = previousFake;
    }
  });

  it("requires a fresh preview token before MCP run mutation", async () => {
    const cwd = setupRepo();
    const runId = await planRun(cwd);
    const run = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: { name: "kiwi_run", arguments: { runId, command: "node -e 0" } },
      },
      cwd,
    );

    expect(run.error?.code).toBe(-32010);
    expect(JSON.stringify(run.error?.data)).toContain("kiwi_preview_run");
  });

  it("rejects stale preview tokens after policy changes and recommends the next safe tool", async () => {
    const cwd = setupRepo();
    const runId = await planRun(cwd);
    const token = await previewRun(cwd, runId);

    const next = await handleMcpRequest(
      { id: 3, method: "tools/call", params: { name: "kiwi_next", arguments: { runId } } },
      cwd,
    );
    const nextParsed = toolJson(next) as { primaryNextTool: string; previewToken: string };
    expect(nextParsed.primaryNextTool).toBe("kiwi_run");
    expect(nextParsed.previewToken).toBe(token);

    writeFileSync(kiwiPolicyPath(cwd), `${readFileSync(kiwiPolicyPath(cwd), "utf-8")}\n# changed\n`, "utf-8");
    const run = await handleMcpRequest(
      {
        id: 4,
        method: "tools/call",
        params: { name: "kiwi_run", arguments: { runId, previewToken: token, command: "node -e 0" } },
      },
      cwd,
    );

    expect(run.error?.code).toBe(-32010);
    expect(run.error?.message).toContain("Stale previewToken");
  });

  it("keeps approval and forceUnsafe on explicit MCP paths", async () => {
    const cwd = setupRepo();
    const runId = await planRun(cwd);
    const approval = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "kiwi_request_approval",
          arguments: { runId, attemptId: "attempt_manual", reason: "manual approval" },
        },
      },
      cwd,
    );
    expect(approval.error).toBeUndefined();

    const apply = await handleMcpRequest(
      {
        id: 3,
        method: "tools/call",
        params: { name: "kiwi_apply", arguments: { runId, forceUnsafe: true } },
      },
      cwd,
    );
    expect(apply.error?.code).toBe(-32010);
    expect(JSON.stringify(apply.error?.data)).toContain("KIWI_MCP_HIGH_RISK_TOOLS");
  });
});
