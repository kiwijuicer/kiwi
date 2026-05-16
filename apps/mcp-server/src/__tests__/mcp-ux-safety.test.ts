import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { kiwiModelRegistryPath, kiwiPolicyPath } from "@kiwi/core";
import { handleMcpRequest } from "../index";

function setupRepo(options: { ignoreKiwi?: boolean } = {}): string {
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
  execFileSync("git", ["init", "-b", "feature"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "kiwi@example.test"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "kiwi"], { cwd, stdio: "ignore" });
  if (options.ignoreKiwi !== false) {
    writeFileSync(path.join(cwd, ".gitignore"), ".kiwi/\n", "utf-8");
    execFileSync("git", ["add", ".gitignore"], { cwd, stdio: "ignore" });
  } else {
    writeFileSync(path.join(cwd, "README.md"), "test\n", "utf-8");
    execFileSync("git", ["add", "README.md"], { cwd, stdio: "ignore" });
  }
  execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });
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

    expect(run.error?.code).toBe(-32602);
    expect(run.error?.data).toMatchObject({
      category: "invalid_input",
    });
  });

  it("blocks direct execution previews on protected, dirty, and untracked repos", async () => {
    const protectedRepo = setupRepo();
    execFileSync("git", ["switch", "-c", "main"], { cwd: protectedRepo, stdio: "ignore" });
    const protectedRunId = await planRun(protectedRepo);
    const protectedPreview = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: { name: "kiwi_preview_run", arguments: { runId: protectedRunId } },
      },
      protectedRepo,
    );
    expect(protectedPreview.error?.code).toBe(-32010);
    expect(protectedPreview.error?.message).toContain("protected-looking");

    const dirtyRepo = setupRepo();
    const dirtyRunId = await planRun(dirtyRepo);
    writeFileSync(path.join(dirtyRepo, ".gitignore"), ".kiwi/\n# dirty\n", "utf-8");
    const dirtyPreview = await handleMcpRequest(
      {
        id: 3,
        method: "tools/call",
        params: { name: "kiwi_preview_run", arguments: { runId: dirtyRunId } },
      },
      dirtyRepo,
    );
    expect(dirtyPreview.error?.code).toBe(-32010);
    expect(dirtyPreview.error?.message).toContain("tracked dirty files");

    const untrackedRepo = setupRepo();
    const untrackedRunId = await planRun(untrackedRepo);
    writeFileSync(path.join(untrackedRepo, "scratch.txt"), "dirty\n", "utf-8");
    const untrackedPreview = await handleMcpRequest(
      {
        id: 4,
        method: "tools/call",
        params: { name: "kiwi_preview_run", arguments: { runId: untrackedRunId } },
      },
      untrackedRepo,
    );
    expect(untrackedPreview.error?.code).toBe(-32010);
    expect(untrackedPreview.error?.message).toContain("untracked non-kiwi files");
  });

  it("keeps preview tokens valid when only kiwi artifacts are written", async () => {
    const cwd = setupRepo({ ignoreKiwi: false });
    const runId = await planRun(cwd);
    const token = await previewRun(cwd, runId);
    const run = await handleMcpRequest(
      {
        id: 3,
        method: "tools/call",
        params: { name: "kiwi_run", arguments: { runId, previewToken: token, command: "node -e 0" } },
      },
      cwd,
    );

    expect(run.error).toBeUndefined();
    expect(JSON.stringify(run.result)).toContain("completed");
  });

  it("rejects stale preview tokens after policy changes and recommends the next safe tool", async () => {
    const cwd = setupRepo();
    const runId = await planRun(cwd);
    const token = await previewRun(cwd, runId);

    const next = await handleMcpRequest(
      { id: 3, method: "tools/call", params: { name: "kiwi_next", arguments: { runId } } },
      cwd,
    );
    const nextParsed = toolJson(next) as {
      nextAction: { recommendedToolCall: { name: string; arguments: { previewToken: string } } };
    };
    expect(nextParsed.nextAction.recommendedToolCall.name).toBe("kiwi_run");
    expect(nextParsed.nextAction.recommendedToolCall.arguments.previewToken).toBe(token);

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
    expect(run.error?.data).toMatchObject({
      category: "stale_preview",
      recovery: {
        recommendedToolCall: { name: "kiwi_preview_run" },
      },
    });
  });

  it("resumes approval only for the same blocked step and approval-required files", async () => {
    const previousIsolation = process.env.KIWI_EXECUTION_ISOLATION;
    process.env.KIWI_EXECUTION_ISOLATION = "worktree";
    try {
      const cwd = setupRepo();
      writeFileSync(
        kiwiPolicyPath(cwd),
        readFileSync(kiwiPolicyPath(cwd), "utf-8").replace("riskZones:\n  high: []", "riskZones:\n  high: [src/auth/**]"),
        "utf-8",
      );
      const planned = await handleMcpRequest(
        {
          id: 1,
          method: "tools/call",
          params: {
            name: "kiwi_plan",
            arguments: { rawInput: "# Approval resume\n\n## Implement", riskProfile: "production", allowStub: true },
          },
        },
        cwd,
      );
      expect(planned.error).toBeUndefined();
      const runId = (toolJson(planned) as { runId: string }).runId;
      const firstToken = await previewRun(cwd, runId);
      const writeApprovedFile =
        "node -e \"const fs=require('fs');fs.mkdirSync('src/auth',{recursive:true});fs.writeFileSync('src/auth/new.ts','x\\n')\"";
      const blocked = await handleMcpRequest(
        {
          id: 3,
          method: "tools/call",
          params: { name: "kiwi_run", arguments: { runId, previewToken: firstToken, command: writeApprovedFile } },
        },
        cwd,
      );
      expect(blocked.error).toBeUndefined();
      const blockedParsed = toolJson(blocked) as { steps: Array<{ stepId: string; attemptId: string; status: string }> };
      expect(blockedParsed.steps[0]?.status).toBe("blocked");
      const stepId = blockedParsed.steps[0]?.stepId ?? "step_001";
      const attemptId = blockedParsed.steps[0]?.attemptId ?? "";

      const approval = await handleMcpRequest(
        {
          id: 4,
          method: "tools/call",
          params: { name: "kiwi_request_approval", arguments: { runId, attemptId, reason: "reviewed" } },
        },
        cwd,
      );
      expect(approval.error).toBeUndefined();

      const next = await handleMcpRequest(
        { id: 5, method: "tools/call", params: { name: "kiwi_next", arguments: { runId } } },
        cwd,
      );
      const nextParsed = toolJson(next) as {
        nextAction: { recommendedToolCall: { name: string; arguments: { fromStep?: string } } };
      };
      expect(nextParsed.nextAction.recommendedToolCall.name).toBe("kiwi_preview_run");
      expect(nextParsed.nextAction.recommendedToolCall.arguments.fromStep).toBe(stepId);

      const secondPreview = await handleMcpRequest(
        {
          id: 6,
          method: "tools/call",
          params: { name: "kiwi_preview_run", arguments: { runId, fromStep: stepId } },
        },
        cwd,
      );
      const secondToken = (toolJson(secondPreview) as { previewToken: string }).previewToken;
      const approvedRun = await handleMcpRequest(
        {
          id: 7,
          method: "tools/call",
          params: {
            name: "kiwi_run",
            arguments: { runId, fromStep: stepId, previewToken: secondToken, command: writeApprovedFile },
          },
        },
        cwd,
      );
      expect(approvedRun.error).toBeUndefined();
      expect(JSON.stringify(approvedRun.result)).toContain("completed");

      const thirdPreview = await handleMcpRequest(
        {
          id: 8,
          method: "tools/call",
          params: { name: "kiwi_preview_run", arguments: { runId, fromStep: stepId } },
        },
        cwd,
      );
      const thirdToken = (toolJson(thirdPreview) as { previewToken: string }).previewToken;
      const writeNewRiskFile =
        "node -e \"const fs=require('fs');fs.mkdirSync('src/auth',{recursive:true});fs.writeFileSync('src/auth/other.ts','x\\n')\"";
      const blockedAgain = await handleMcpRequest(
        {
          id: 9,
          method: "tools/call",
          params: {
            name: "kiwi_run",
            arguments: { runId, fromStep: stepId, previewToken: thirdToken, command: writeNewRiskFile },
          },
        },
        cwd,
      );
      expect(blockedAgain.error).toBeUndefined();
      expect(JSON.stringify(blockedAgain.result)).toContain("blocked");
    } finally {
      if (previousIsolation === undefined) delete process.env.KIWI_EXECUTION_ISOLATION;
      else process.env.KIWI_EXECUTION_ISOLATION = previousIsolation;
    }
  });

  it("rejects fake approval attempts and MCP forceUnsafe", async () => {
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
    expect(approval.error?.code).toBe(-32010);
    expect(approval.error?.data).toMatchObject({
      recovery: {
        recommendedToolCall: { name: "kiwi_next" },
      },
    });

    const apply = await handleMcpRequest(
      {
        id: 3,
        method: "tools/call",
        params: { name: "kiwi_apply", arguments: { runId, forceUnsafe: true } },
      },
      cwd,
    );
    expect(apply.error?.code).toBe(-32602);
    expect(apply.error?.data).toMatchObject({
      category: "invalid_input",
    });
  });
});
