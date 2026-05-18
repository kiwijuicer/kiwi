import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendModelInvocation,
  kiwiHomeModelRegistryPath,
  kiwiHomePolicyPath,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  listStepAttemptEvidence,
} from "@kiwi/core";
import type { RunExecutionPreview } from "@kiwi/runtime";
import { handleMcpRequest } from "..";
import { createMcpPreviewToken, latestValidPreviewToken, normalizePreviewInput } from "../tools/preview-tokens";

let previousKiwiHome: string | undefined;

beforeEach(() => {
  previousKiwiHome = process.env.KIWI_HOME;
  process.env.KIWI_HOME = mkdtempSync(path.join(os.tmpdir(), "kiwi-mcp-ux-home-"));
});

afterEach(() => {
  if (previousKiwiHome === undefined) {
    delete process.env.KIWI_HOME;
  } else {
    process.env.KIWI_HOME = previousKiwiHome;
  }
});

function setupRepo(options: { ignoreKiwi?: boolean } = {}): string {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-mcp-ux-"));
  mkdirSync(path.join(cwd, ".kiwi", "runs"), { recursive: true });
  mkdirSync(path.join(cwd, ".kiwi", "logs"), { recursive: true });
  writeFileSync(path.join(cwd, ".kiwi", "config.yaml"), 'version: "1"\n', "utf-8");
  const policyYaml = `version: "1"
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
`;
  const registryYaml = `version: "1"
models:
  - id: stub-frontier
    provider: stub
    capability: frontier
    roles: [planner, reviewer]
    enabled: true
`;
  mkdirSync(path.dirname(kiwiHomePolicyPath()), { recursive: true });
  mkdirSync(path.dirname(kiwiHomeModelRegistryPath()), { recursive: true });
  writeFileSync(kiwiHomePolicyPath(), policyYaml, "utf-8");
  writeFileSync(kiwiHomeModelRegistryPath(), registryYaml, "utf-8");
  writeFileSync(kiwiPolicyPath(cwd), policyYaml, "utf-8");
  writeFileSync(kiwiModelRegistryPath(cwd), registryYaml, "utf-8");
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

async function planRun(cwd: string, riskProfile: "dev" | "production" = "dev"): Promise<string> {
  const planned = await handleMcpRequest(
    {
      id: 1,
      method: "tools/call",
      params: {
        name: "kiwi_plan",
        arguments: { rawInput: "# UX Safety\n\n## Validate", riskProfile },
      },
    },
    cwd,
  );
  expect(planned.error).toBeUndefined();

  return (toolJson(planned) as { runId: string }).runId;
}

async function previewRun(cwd: string, runId: string, args: Record<string, unknown> = {}): Promise<string> {
  const preview = await handleMcpRequest(
    {
      id: 2,
      method: "tools/call",
      params: {
        name: "kiwi_preview_run",
        arguments: { runId, ...args },
      },
    },
    cwd,
  );
  expect(preview.error).toBeUndefined();

  return (toolJson(preview) as { previewToken: string }).previewToken;
}

describe("MCP UX safety tools", () => {
  it("lists doctor and next tools", async () => {
    const tools = await handleMcpRequest({ id: 1, method: "tools/list" }, setupRepo());
    const payload = JSON.stringify(tools.result);
    expect(payload).toContain("kiwi_doctor");
    expect(payload).toContain("kiwi_next");
    expect(payload).toContain("READ_ONLY");
    const listedTools = (tools.result as { tools: Array<{ name: string; description: string }> }).tools;
    const runDescription = listedTools.find((tool) => tool.name === "kiwi_run")?.description ?? "";
    const planDescription = listedTools.find((tool) => tool.name === "kiwi_plan")?.description ?? "";
    const safetyNote = "Do not stage, commit, tag, or push unless the user explicitly requested that git operation.";

    expect(runDescription.startsWith(safetyNote)).toBe(true);
    expect(planDescription.startsWith(safetyNote)).toBe(true);
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
      const parsed = toolJson(doctor) as {
        safeToPlan: boolean;
        safeToRun: boolean;
        git: { dirtyFiles: number };
        recommendedFirstToolCall: unknown;
        readyForTool: { name: string; requiredInput: string } | null;
      };
      expect(parsed.safeToPlan).toBe(true);
      expect(parsed.safeToRun).toBe(false);
      expect(parsed.git.dirtyFiles).toBeGreaterThan(0);
      expect(parsed.recommendedFirstToolCall).toBeNull();
      expect(parsed.readyForTool).toMatchObject({ name: "kiwi_plan", requiredInput: "ticket or rawInput" });

      const missing = mkdtempSync(path.join(os.tmpdir(), "kiwi-mcp-missing-"));
      const missingDoctor = await handleMcpRequest(
        { id: 2, method: "tools/call", params: { name: "kiwi_doctor", arguments: { workspacePath: missing } } },
        os.tmpdir(),
      );
      const missingParsed = toolJson(missingDoctor) as { safeToPlan: boolean; warnings: string[] };
      expect(missingParsed.safeToPlan).toBe(false);
      expect(missingParsed.warnings).toContain("workspace is not initialized");
    } finally {
      if (previousFake === undefined) {
        delete process.env.KIWI_FAKE_BINARY_AVAILABLE;
      } else {
        process.env.KIWI_FAKE_BINARY_AVAILABLE = previousFake;
      }
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
    const command = "node -e 0";
    const token = await previewRun(cwd, runId, { command });
    const run = await handleMcpRequest(
      {
        id: 3,
        method: "tools/call",
        params: { name: "kiwi_run", arguments: { runId, previewToken: token, command } },
      },
      cwd,
    );

    expect(run.error).toBeUndefined();
    expect(JSON.stringify(run.result)).toContain("completed");
  });

  it("makes preview tokens single-use and skips already completed steps on fresh previews", async () => {
    const cwd = setupRepo();
    const runId = await planRun(cwd);
    const command = "node -e 0";
    const firstToken = await previewRun(cwd, runId, { command });
    const firstRun = await handleMcpRequest(
      {
        id: 3,
        method: "tools/call",
        params: { name: "kiwi_run", arguments: { runId, previewToken: firstToken, command } },
      },
      cwd,
    );
    expect(firstRun.error).toBeUndefined();
    const attemptsAfterFirstRun = listStepAttemptEvidence(cwd, runId);
    expect(latestValidPreviewToken({ cwd, runId, previewInput: normalizePreviewInput({}) })).toBeNull();

    const reusedToken = await handleMcpRequest(
      {
        id: 4,
        method: "tools/call",
        params: { name: "kiwi_run", arguments: { runId, previewToken: firstToken, command } },
      },
      cwd,
    );
    expect(reusedToken.error?.code).toBe(-32010);
    expect(reusedToken.error?.message).toContain("already consumed");

    const secondToken = await previewRun(cwd, runId, { command });
    const secondRun = await handleMcpRequest(
      {
        id: 5,
        method: "tools/call",
        params: { name: "kiwi_run", arguments: { runId, previewToken: secondToken, command } },
      },
      cwd,
    );
    expect(secondRun.error).toBeUndefined();
    const secondParsed = toolJson(secondRun) as { steps: Array<{ status: string }> };
    expect(secondParsed.steps.length).toBeGreaterThan(0);
    expect(secondParsed.steps.every((step) => step.status === "skipped")).toBe(true);
    expect(listStepAttemptEvidence(cwd, runId)).toHaveLength(attemptsAfterFirstRun.length);
  });

  it("prunes old preview token files while keeping the newest 25", async () => {
    const cwd = setupRepo();
    const runId = await planRun(cwd);
    const tokens: string[] = [];
    const preview = {
      runId,
      executionOwner: "kiwi-codex-cli",
      executionIsolation: "direct",
      maxConcurrency: 2,
      subPlans: [],
      steps: [{ stepId: "step_001" }],
    } as unknown as RunExecutionPreview;
    const previewInput = normalizePreviewInput({});

    for (let index = 0; index < 30; index += 1) {
      tokens.push(
        createMcpPreviewToken({
          cwd,
          runId,
          preview,
          previewInput,
          now: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        }).token,
      );
    }

    const previewDir = path.join(cwd, ".kiwi", "runs", runId, "previews");
    const files = readdirSync(previewDir)
      .filter((entry) => entry.endsWith(".json"))
      .sort();

    expect(files).toHaveLength(25);
    expect(files).toContain(`${tokens.at(-1)}.json`);
    expect(files).not.toContain(`${tokens[0]}.json`);
    expect(latestValidPreviewToken({ cwd, runId, previewInput })?.token).toBe(tokens.at(-1));
  });

  it("rejects command overrides for production-risk runs without server opt-in", async () => {
    const cwd = setupRepo();
    const runId = await planRun(cwd, "production");
    const command = "node -e 0";
    const preview = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "kiwi_preview_run",
          arguments: { runId, command },
        },
      },
      cwd,
    );
    expect(preview.error?.code).toBe(-32010);
    expect(preview.error?.data).toMatchObject({
      category: "action_required",
      recovery: {
        recommendedToolCall: { name: "kiwi_next" },
      },
    });
    expect(JSON.stringify(preview.error?.data)).toContain("riskProfile is production");
    expect(JSON.stringify(preview.error?.data)).toContain("KIWI_ALLOW_MCP_COMMAND_OVERRIDE=1");
  });

  it("rejects stale preview tokens after policy changes and recommends the next safe tool", async () => {
    const cwd = setupRepo();
    const runId = await planRun(cwd);
    const command = "node -e 0";
    const token = await previewRun(cwd, runId, { command });

    const next = await handleMcpRequest(
      { id: 3, method: "tools/call", params: { name: "kiwi_next", arguments: { runId, command } } },
      cwd,
    );
    const nextParsed = toolJson(next) as {
      nextAction: { recommendedToolCall: { name: string; arguments: { previewToken: string } } };
    };
    expect(nextParsed.nextAction.recommendedToolCall.name).toBe("kiwi_run");
    expect(nextParsed.nextAction.recommendedToolCall.arguments.previewToken).toBe(token);

    writeFileSync(
      kiwiPolicyPath(cwd),
      readFileSync(kiwiPolicyPath(cwd), "utf-8").replace("test: node -e 0", "test: node -e 1"),
      "utf-8",
    );
    const run = await handleMcpRequest(
      {
        id: 4,
        method: "tools/call",
        params: { name: "kiwi_run", arguments: { runId, previewToken: token, command } },
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

  it("rejects stale preview tokens after home policy defaults change", async () => {
    const cwd = setupRepo();
    const runId = await planRun(cwd);
    const command = "node -e 0";
    const token = await previewRun(cwd, runId, { command });
    const homePolicyPath = kiwiHomePolicyPath();

    mkdirSync(path.dirname(homePolicyPath), { recursive: true });
    writeFileSync(
      homePolicyPath,
      `${readFileSync(kiwiPolicyPath(cwd), "utf-8")}
execution:
  owner: kiwi-codex-cli
  isolation: direct
  sandbox: workspace-write
  forbidStaging: true
  forbidCommits: true
  forbidPushes: true
`,
      "utf-8",
    );

    const run = await handleMcpRequest(
      {
        id: 4,
        method: "tools/call",
        params: { name: "kiwi_run", arguments: { runId, previewToken: token, command } },
      },
      cwd,
    );

    expect(run.error?.code).toBe(-32010);
    expect(run.error?.message).toContain("Stale previewToken");
  });

  it("rejects command changes after preview confirmation", async () => {
    const cwd = setupRepo();
    const runId = await planRun(cwd);
    const token = await previewRun(cwd, runId, { command: "node -e 0" });

    const run = await handleMcpRequest(
      {
        id: 3,
        method: "tools/call",
        params: { name: "kiwi_run", arguments: { runId, previewToken: token, command: "node -e 1" } },
      },
      cwd,
    );

    expect(run.error?.code).toBe(-32010);
    expect(run.error?.data).toMatchObject({
      category: "stale_preview",
      recovery: { recommendedToolCall: { name: "kiwi_preview_run" } },
    });
    expect(JSON.stringify(run.error?.data)).toContain("command differs from the preview");
  });

  it("does not recommend execution when the latest preview is blocked", async () => {
    const cwd = setupRepo();
    const planned = await handleMcpRequest(
      {
        id: 1,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: { rawInput: "# Blocked preview\n\n## Validate", budgetProfile: "tiny" },
        },
      },
      cwd,
    );
    expect(planned.error).toBeUndefined();
    const runId = (toolJson(planned) as { runId: string }).runId;
    appendModelInvocation(cwd, {
      schemaVersion: "1",
      runId,
      phase: "executor",
      stepId: "step_001",
      attemptId: "attempt_spent",
      agentRole: "executor",
      selectedCapability: "mid",
      modelId: "spent-model",
      providerName: "stub",
      runner: "local-shell",
      accessMode: "local",
      usage: { inputTokens: 0, outputTokens: 0 },
      usagePrecision: "estimated",
      estimatedCostUsd: 0.5,
      status: "completed",
      evidenceRefs: [],
      startedAt: "2026-05-18T08:00:00.000Z",
      completedAt: "2026-05-18T08:00:01.000Z",
    });

    const preview = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: { name: "kiwi_preview_run", arguments: { runId } },
      },
      cwd,
    );
    expect(preview.error).toBeUndefined();
    const previewParsed = toolJson(preview) as {
      decision: { requiresUserConfirmation: boolean; nextAction: { recommendedToolCall: { name: string } } };
      steps: Array<{ status: string; blockedReason?: string }>;
    };
    expect(previewParsed.steps.some((step) => step.status === "blocked")).toBe(true);
    expect(previewParsed.steps.some((step) => step.blockedReason === "budget_hard_cap_exhausted")).toBe(true);
    expect(previewParsed.decision.requiresUserConfirmation).toBe(false);
    expect(previewParsed.decision.nextAction.recommendedToolCall.name).toBe("kiwi_preview_run");

    const next = await handleMcpRequest(
      { id: 3, method: "tools/call", params: { name: "kiwi_next", arguments: { runId } } },
      cwd,
    );
    const nextParsed = toolJson(next) as {
      nextAction: { recommendedToolCall: { name: string } };
      blockedBy: string[];
    };
    expect(nextParsed.nextAction.recommendedToolCall.name).toBe("kiwi_preview_run");
    expect(JSON.stringify(nextParsed.blockedBy)).toContain("budget_hard_cap_exhausted");
  });

  it("resumes approval only for the same blocked step and approval-required files", async () => {
    const previousIsolation = process.env.KIWI_EXECUTION_ISOLATION;
    const previousCommandOverride = process.env.KIWI_ALLOW_MCP_COMMAND_OVERRIDE;
    process.env.KIWI_EXECUTION_ISOLATION = "worktree";
    process.env.KIWI_ALLOW_MCP_COMMAND_OVERRIDE = "1";
    try {
      const cwd = setupRepo();
      writeFileSync(
        kiwiPolicyPath(cwd),
        readFileSync(kiwiPolicyPath(cwd), "utf-8").replace(
          "riskZones:\n  high: []",
          "riskZones:\n  high: [src/auth/**]",
        ),
        "utf-8",
      );
      const planned = await handleMcpRequest(
        {
          id: 1,
          method: "tools/call",
          params: {
            name: "kiwi_plan",
            arguments: { rawInput: "# Approval resume\n\n## Implement", riskProfile: "production" },
          },
        },
        cwd,
      );
      expect(planned.error).toBeUndefined();
      const runId = (toolJson(planned) as { runId: string }).runId;
      const writeApprovedFile =
        "node -e \"const fs=require('fs');fs.mkdirSync('src/auth',{recursive:true});fs.writeFileSync('src/auth/new.ts','x\\n')\"";
      const firstToken = await previewRun(cwd, runId, { command: writeApprovedFile });
      const blocked = await handleMcpRequest(
        {
          id: 3,
          method: "tools/call",
          params: { name: "kiwi_run", arguments: { runId, previewToken: firstToken, command: writeApprovedFile } },
        },
        cwd,
      );
      expect(blocked.error).toBeUndefined();
      const blockedParsed = toolJson(blocked) as {
        steps: Array<{ stepId: string; attemptId: string; status: string }>;
      };
      expect(blockedParsed.steps[0]?.status).toBe("blocked");
      const stepId = blockedParsed.steps[0]?.stepId ?? "step_001";
      const attemptId = blockedParsed.steps[0]?.attemptId ?? "";

      const approvalNext = await handleMcpRequest(
        { id: 4, method: "tools/call", params: { name: "kiwi_next", arguments: { runId } } },
        cwd,
      );
      const approvalNextParsed = toolJson(approvalNext) as {
        nextAction: { recommendedToolCall: null | { name: string } };
        blockedBy: string[];
      };
      expect(approvalNextParsed.nextAction.recommendedToolCall).toBeNull();
      expect(JSON.stringify(approvalNextParsed.blockedBy)).toContain("approvedBy");

      const approval = await handleMcpRequest(
        {
          id: 5,
          method: "tools/call",
          params: {
            name: "kiwi_request_approval",
            arguments: { runId, attemptId, reason: "reviewed", approvedBy: "norbert" },
          },
        },
        cwd,
      );
      expect(approval.error).toBeUndefined();

      const next = await handleMcpRequest(
        { id: 6, method: "tools/call", params: { name: "kiwi_next", arguments: { runId } } },
        cwd,
      );
      const nextParsed = toolJson(next) as {
        nextAction: { recommendedToolCall: { name: string; arguments: { fromStep?: string } } };
      };
      expect(nextParsed.nextAction.recommendedToolCall.name).toBe("kiwi_preview_run");
      expect(nextParsed.nextAction.recommendedToolCall.arguments.fromStep).toBe(stepId);

      const secondPreview = await handleMcpRequest(
        {
          id: 7,
          method: "tools/call",
          params: { name: "kiwi_preview_run", arguments: { runId, fromStep: stepId, command: writeApprovedFile } },
        },
        cwd,
      );
      const secondToken = (toolJson(secondPreview) as { previewToken: string }).previewToken;
      const approvedRun = await handleMcpRequest(
        {
          id: 8,
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

      const writeNewRiskFile =
        "node -e \"const fs=require('fs');fs.mkdirSync('src/auth',{recursive:true});fs.writeFileSync('src/auth/other.ts','x\\n')\"";
      const thirdPreview = await handleMcpRequest(
        {
          id: 9,
          method: "tools/call",
          params: { name: "kiwi_preview_run", arguments: { runId, fromStep: stepId, command: writeNewRiskFile } },
        },
        cwd,
      );
      const thirdToken = (toolJson(thirdPreview) as { previewToken: string }).previewToken;
      const blockedAgain = await handleMcpRequest(
        {
          id: 10,
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
      if (previousIsolation === undefined) {
        delete process.env.KIWI_EXECUTION_ISOLATION;
      } else {
        process.env.KIWI_EXECUTION_ISOLATION = previousIsolation;
      }
      if (previousCommandOverride === undefined) {
        delete process.env.KIWI_ALLOW_MCP_COMMAND_OVERRIDE;
      } else {
        process.env.KIWI_ALLOW_MCP_COMMAND_OVERRIDE = previousCommandOverride;
      }
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
          arguments: { runId, attemptId: "attempt_manual", reason: "manual approval", approvedBy: "norbert" },
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
    expect(JSON.stringify(apply.error?.data)).toContain("previewToken");
    expect(JSON.stringify(apply.error?.data)).toContain("forceUnsafe");
  });

  it("rejects unknown arguments on mutating tools as invalid_input", async () => {
    const cwd = setupRepo();
    const runId = await planRun(cwd);

    const runWithUnknown = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "kiwi_run",
          arguments: { runId, previewToken: "preview_anything", forceUnsafe: true },
        },
      },
      cwd,
    );
    expect(runWithUnknown.error?.code).toBe(-32602);
    expect(runWithUnknown.error?.data).toMatchObject({ category: "invalid_input" });
    expect(JSON.stringify(runWithUnknown.error?.data)).toContain("forceUnsafe");

    const planWithUnknown = await handleMcpRequest(
      {
        id: 3,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: { ticket: "# Strict\n\n## Plan", approved: true },
        },
      },
      cwd,
    );
    expect(planWithUnknown.error?.code).toBe(-32602);
    expect(planWithUnknown.error?.data).toMatchObject({ category: "invalid_input" });
    expect(JSON.stringify(planWithUnknown.error?.data)).toContain("approved");

    const finalizeWithUnknown = await handleMcpRequest(
      {
        id: 4,
        method: "tools/call",
        params: {
          name: "kiwi_finalize",
          arguments: { runId, skipChecks: true },
        },
      },
      cwd,
    );
    expect(finalizeWithUnknown.error?.code).toBe(-32602);
    expect(finalizeWithUnknown.error?.data).toMatchObject({ category: "invalid_input" });
    expect(JSON.stringify(finalizeWithUnknown.error?.data)).toContain("skipChecks");
  });

  it("rejects kiwi_request_approval without an explicit approvedBy identity", async () => {
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
    expect(approval.error?.code).toBe(-32602);
    expect(approval.error?.data).toMatchObject({
      category: "invalid_input",
    });
    expect(JSON.stringify(approval.error?.data)).toContain("approvedBy");
  });

  it("rejects placeholder approvedBy identities", async () => {
    const cwd = setupRepo();
    const runId = await planRun(cwd);
    const approval = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "kiwi_request_approval",
          arguments: { runId, attemptId: "attempt_manual", reason: "manual approval", approvedBy: "mcp-operator" },
        },
      },
      cwd,
    );

    expect(approval.error?.code).toBe(-32602);
    expect(approval.error?.data).toMatchObject({ category: "invalid_input" });
    expect(JSON.stringify(approval.error?.data)).toContain("placeholder identity");
  });
});
