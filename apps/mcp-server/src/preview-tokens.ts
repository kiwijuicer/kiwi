import { createHash, randomBytes } from "crypto";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import {
  appendAuditEvent,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  loadInitiative,
  loadTaskGraph,
  readJson,
  resolveRunArtifactPath,
  writeJsonSafely,
} from "@kiwi/core";
import type { ExecutionIsolation } from "@kiwi/contracts";
import { DEFAULT_MAX_CONCURRENCY, readExecutionRepoState, type RunExecutionPreview } from "@kiwi/runtime";
import { ToolActionRequiredError } from "./tool-errors";
import { safeReadOnlyToolCalls, toolCall } from "./ux";

interface McpPreviewInput {
  fromStep: string | null;
  maxConcurrency: number;
  maxConcurrencyExplicit?: boolean;
}

interface McpPreviewFingerprints {
  taskGraphHash: string;
  policyHash: string;
  registryHash: string;
  repoHead: string | null;
  repoBranch: string | null;
  dirtyStateHash: string;
}

interface McpPreviewTokenRecord {
  schemaVersion: "1";
  token: string;
  runId: string;
  workspacePath: string;
  repoPath: string;
  createdAt: string;
  previewInput: McpPreviewInput;
  executionIsolation: ExecutionIsolation;
  fingerprints: McpPreviewFingerprints;
  stateHash: string;
  previewStepIds: string[];
  consumedAt?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizePreviewInput(args: {
  fromStep?: string | undefined;
  maxConcurrency?: number | undefined;
}): McpPreviewInput {
  const input: McpPreviewInput = {
    fromStep: args.fromStep ?? null,
    maxConcurrency: args.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
  };

  if (args.maxConcurrency !== undefined) {
    input.maxConcurrencyExplicit = true;
  }

  return input;
}

export function previewInputToolArgs(input: McpPreviewInput): Record<string, unknown> {
  return {
    ...(input.fromStep ? { fromStep: input.fromStep } : {}),
    ...(input.maxConcurrencyExplicit === true ? { maxConcurrency: input.maxConcurrency } : {}),
  };
}

function previewPath(cwd: string, runId: string, token: string): string {
  if (!/^preview_[a-f0-9_]+$/.test(token)) {
    throw new ToolActionRequiredError("Invalid previewToken", {
      category: "action_required",
      recovery: {
        reason: "preview token format is invalid",
        recommendedToolCall: toolCall("kiwi_preview_run", { workspacePath: cwd, runId }),
        safeAlternatives: safeReadOnlyToolCalls({ workspacePath: cwd, runId }),
        userMessage: "The preview token is malformed. Create a new preview before running.",
      },
    });
  }

  return resolveRunArtifactPath(runId, `previews/${token}.json`, cwd);
}

function hashPolicy(cwd: string): string {
  const target = kiwiPolicyPath(cwd);

  return existsSync(target) ? sha256(readFileSync(target, "utf-8")) : sha256("missing-policy");
}

function hashRegistry(cwd: string): string {
  const target = kiwiModelRegistryPath(cwd);

  return existsSync(target) ? sha256(readFileSync(target, "utf-8")) : sha256("missing-registry");
}

function fingerprintState(cwd: string, runId: string): { repoPath: string; fingerprints: McpPreviewFingerprints } {
  const initiative = loadInitiative(runId, cwd);
  const repoPath = initiative.repoPath || cwd;
  const repoState = readExecutionRepoState(repoPath);

  return {
    repoPath,
    fingerprints: {
      taskGraphHash: sha256(JSON.stringify(loadTaskGraph(runId, cwd))),
      policyHash: hashPolicy(cwd),
      registryHash: hashRegistry(cwd),
      repoHead: repoState.head,
      repoBranch: repoState.branch,
      dirtyStateHash: repoState.dirtyStateHash,
    },
  };
}

function previewInputFingerprint(previewInput: McpPreviewInput): Pick<McpPreviewInput, "fromStep" | "maxConcurrency"> {
  return {
    fromStep: previewInput.fromStep,
    maxConcurrency: previewInput.maxConcurrency,
  };
}

function stateHash(fingerprints: McpPreviewFingerprints, previewInput: McpPreviewInput): string {
  return sha256(JSON.stringify({ fingerprints, previewInput: previewInputFingerprint(previewInput) }));
}

export function createMcpPreviewToken(params: {
  cwd: string;
  runId: string;
  preview: RunExecutionPreview;
  previewInput: McpPreviewInput;
  now?: Date;
}): McpPreviewTokenRecord {
  const { repoPath, fingerprints } = fingerprintState(params.cwd, params.runId);
  const hash = stateHash(fingerprints, params.previewInput);
  const token = `preview_${hash.slice(0, 16)}_${randomBytes(8).toString("hex")}`;
  const record: McpPreviewTokenRecord = {
    schemaVersion: "1",
    token,
    runId: params.runId,
    workspacePath: params.cwd,
    repoPath,
    createdAt: (params.now ?? new Date()).toISOString(),
    previewInput: params.previewInput,
    executionIsolation: params.preview.executionIsolation,
    fingerprints,
    stateHash: hash,
    previewStepIds: params.preview.steps.map((step) => step.stepId),
  };
  writeJsonSafely(previewPath(params.cwd, params.runId, token), record);
  appendAuditEvent(params.cwd, {
    eventType: "mcp_preview_created",
    runId: params.runId,
    timestamp: record.createdAt,
    payload: {
      token,
      stateHash: hash,
      fromStep: params.previewInput.fromStep,
      maxConcurrency: params.previewInput.maxConcurrency,
      stepIds: record.previewStepIds,
    },
  });

  return record;
}

function loadPreviewRecord(cwd: string, runId: string, token: string): McpPreviewTokenRecord {
  const target = previewPath(cwd, runId, token);

  if (!existsSync(target)) {
    throw new ToolActionRequiredError("kiwi_run requires a valid previewToken from kiwi_preview_run", {
      category: "action_required",
      recovery: {
        reason: "preview token was not found",
        recommendedToolCall: toolCall("kiwi_preview_run", { workspacePath: cwd, runId }),
        safeAlternatives: safeReadOnlyToolCalls({ workspacePath: cwd, runId }),
        userMessage: "The preview token was not found. Create a new preview before running.",
      },
    });
  }

  return readJson(target) as McpPreviewTokenRecord;
}

function rejectStale(params: { cwd: string; runId: string; reason: string }): never {
  throw new ToolActionRequiredError(`Stale previewToken: ${params.reason}`, {
    category: "stale_preview",
    recovery: {
      reason: params.reason,
      recommendedToolCall: toolCall("kiwi_preview_run", { workspacePath: params.cwd, runId: params.runId }),
      safeAlternatives: safeReadOnlyToolCalls({ workspacePath: params.cwd, runId: params.runId }),
      userMessage: "The run changed since preview. Create and confirm a fresh preview before running.",
    },
  });
}

export function validateMcpPreviewToken(params: {
  cwd: string;
  runId: string;
  previewToken: string | undefined;
  previewInput?: McpPreviewInput | undefined;
  stepId?: string | undefined;
}): McpPreviewTokenRecord {
  if (!params.previewToken) {
    throw new ToolActionRequiredError("kiwi_run requires previewToken from kiwi_preview_run before MCP mutation", {
      category: "action_required",
      recovery: {
        reason: "mutating MCP calls require a fresh preview",
        recommendedToolCall: toolCall("kiwi_preview_run", { workspacePath: params.cwd, runId: params.runId }),
        safeAlternatives: safeReadOnlyToolCalls({ workspacePath: params.cwd, runId: params.runId }),
        userMessage: "Preview this run and ask the user to confirm before calling a mutating tool.",
      },
    });
  }
  const record = loadPreviewRecord(params.cwd, params.runId, params.previewToken);

  if (record.runId !== params.runId) {
    rejectStale({ cwd: params.cwd, runId: params.runId, reason: "preview token belongs to a different run" });
  }
  if (record.consumedAt) {
    rejectStale({ cwd: params.cwd, runId: params.runId, reason: "preview token was already consumed" });
  }
  const current = fingerprintState(params.cwd, params.runId);
  const currentHash = stateHash(current.fingerprints, record.previewInput);

  if (currentHash !== record.stateHash) {
    rejectStale({ cwd: params.cwd, runId: params.runId, reason: "TaskGraph, policy, HEAD, or dirty state changed" });
  }
  if (params.previewInput) {
    if (
      record.previewInput.fromStep !== params.previewInput.fromStep ||
      record.previewInput.maxConcurrency !== params.previewInput.maxConcurrency
    ) {
      rejectStale({
        cwd: params.cwd,
        runId: params.runId,
        reason: "fromStep or maxConcurrency differs from the preview",
      });
    }
  }
  if (params.stepId && !record.previewStepIds.includes(params.stepId)) {
    rejectStale({
      cwd: params.cwd,
      runId: params.runId,
      reason: `step ${params.stepId} was not included in the preview`,
    });
  }

  return record;
}

export function consumeMcpPreviewToken(params: {
  cwd: string;
  runId: string;
  record: McpPreviewTokenRecord;
  stepId?: string | undefined;
}): McpPreviewTokenRecord {
  const consumedAt = new Date().toISOString();
  const consumedRecord: McpPreviewTokenRecord = {
    ...params.record,
    consumedAt,
  };

  writeJsonSafely(previewPath(params.cwd, params.runId, params.record.token), consumedRecord);
  appendAuditEvent(params.cwd, {
    eventType: "mcp_preview_consumed",
    runId: params.runId,
    timestamp: consumedAt,
    payload: {
      token: params.record.token,
      stepId: params.stepId ?? null,
    },
  });
  appendAuditEvent(params.cwd, {
    eventType: "mcp_preview_invalidated",
    runId: params.runId,
    timestamp: consumedAt,
    payload: {
      token: params.record.token,
      reason: "consumed",
    },
  });

  return consumedRecord;
}

function previewDir(cwd: string, runId: string): string {
  return resolveRunArtifactPath(runId, "previews", cwd);
}

export function latestValidPreviewToken(params: {
  cwd: string;
  runId: string;
  previewInput: McpPreviewInput;
}): McpPreviewTokenRecord | null {
  const dir = previewDir(params.cwd, params.runId);

  if (!existsSync(dir)) {
    return null;
  }
  const records = readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => {
      try {
        return readJson(path.join(dir, entry)) as McpPreviewTokenRecord;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is McpPreviewTokenRecord => entry !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  let current: ReturnType<typeof fingerprintState>;

  try {
    current = fingerprintState(params.cwd, params.runId);
  } catch {
    return null;
  }

  for (const record of records) {
    const currentHash = stateHash(current.fingerprints, record.previewInput);

    if (record.consumedAt) {
      continue;
    }
    if (currentHash !== record.stateHash) {
      continue;
    }
    if (
      record.previewInput.fromStep !== params.previewInput.fromStep ||
      record.previewInput.maxConcurrency !== params.previewInput.maxConcurrency
    ) {
      continue;
    }

    return record;
  }

  return null;
}
