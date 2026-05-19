import { existsSync, mkdirSync } from "fs";
import path from "path";
import {
  ModelRegistryUpdateService,
  readJson,
  resolveKiwiHome,
  writeJsonSafely,
  type ModelRegistryDiff,
} from "@kiwi/core";
import { toolCall, workspaceToolArgs } from "../ux";
import { workspaceArgs } from "../workspace";

interface ModelUpdatePreviewRecord {
  schemaVersion: "1";
  previewToken: string;
  workspacePath: string;
  catalogPath: string;
  diff: ModelRegistryDiff;
  createdAt: string;
}

const modelCatalogLocator = {
  candidates(configured: string | undefined): string[] {
    return [
      ...(configured ? [configured] : []),
      ...(process.env.KIWI_MODEL_CATALOG_PATH ? [process.env.KIWI_MODEL_CATALOG_PATH] : []),
      path.resolve(__dirname, "../../../config/model-catalog.json"),
      path.resolve(__dirname, "../../../../../config/model-catalog.json"),
      path.resolve(process.cwd(), "config/model-catalog.json"),
    ];
  },
  resolve(configured: string | undefined): string {
    for (const candidate of modelCatalogLocator.candidates(configured)) {
      const resolved = path.resolve(candidate);

      if (existsSync(resolved)) {
        return resolved;
      }
    }

    throw new Error("Model catalog not found. Set KIWI_MODEL_CATALOG_PATH or run from a kiwi release checkout.");
  },
};

const modelUpdatePreviewStore = {
  dir(): string {
    return path.join(resolveKiwiHome(process.env), "previews", "model-updates");
  },
  path(previewToken: string): string {
    if (!/^model_preview_[a-z0-9_]+$/.test(previewToken)) {
      throw new Error("Invalid model update previewToken.");
    }

    return path.join(modelUpdatePreviewStore.dir(), `${previewToken}.json`);
  },
  createToken(): string {
    return `model_preview_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  },
  write(record: ModelUpdatePreviewRecord): void {
    mkdirSync(modelUpdatePreviewStore.dir(), { recursive: true });
    writeJsonSafely(modelUpdatePreviewStore.path(record.previewToken), record);
  },
  read(previewToken: string): ModelUpdatePreviewRecord {
    return readJson(modelUpdatePreviewStore.path(previewToken)) as ModelUpdatePreviewRecord;
  },
};

export function modelsUpdateTool(args: Record<string, unknown>, cwd: string): unknown {
  const workspace = workspaceArgs(args, cwd, false);
  const catalogPath = modelCatalogLocator.resolve(typeof args.catalogPath === "string" ? args.catalogPath : undefined);
  const result = new ModelRegistryUpdateService().update({
    catalogPath,
    workspacePath: workspace.workspacePath,
    apply: false,
  });
  const previewToken = modelUpdatePreviewStore.createToken();
  const record: ModelUpdatePreviewRecord = {
    schemaVersion: "1",
    previewToken,
    workspacePath: workspace.workspacePath,
    catalogPath,
    diff: result.diff,
    createdAt: new Date().toISOString(),
  };

  modelUpdatePreviewStore.write(record);

  return {
    schemaVersion: "2",
    kind: "model_registry_update_preview",
    previewToken,
    applied: false,
    homeRegistryPath: result.homeRegistryPath,
    workspaceRegistryPath: result.workspaceRegistryPath,
    diff: result.diff,
    nextAction: {
      recommendedToolCall: toolCall("kiwi_models_update_apply", {
        ...workspaceToolArgs({
          workspacePath: workspace.workspacePath,
          repoId: workspace.repo?.id,
          repoPath: workspace.repo?.path,
        }),
        previewToken,
      }),
      whyThisTool: "The model registry update preview was created and must be confirmed before writing home defaults.",
      requiresUserConfirmation: true,
      expectedMutation: "WRITES_RUN_ARTIFACTS",
      expectedAfter: "Home model defaults are refreshed from the curated catalog.",
    },
  };
}

export function modelsUpdateApplyTool(args: Record<string, unknown>, cwd: string): unknown {
  const workspace = workspaceArgs(args, cwd, false);
  const previewToken = String(args.previewToken ?? "");
  const record = modelUpdatePreviewStore.read(previewToken);

  if (record.workspacePath !== workspace.workspacePath) {
    throw new Error("Stale model update previewToken: workspace changed.");
  }
  const preview = new ModelRegistryUpdateService().update({
    catalogPath: record.catalogPath,
    workspacePath: workspace.workspacePath,
    apply: false,
  });

  if (JSON.stringify(preview.diff) !== JSON.stringify(record.diff)) {
    throw new Error("Stale model update previewToken: catalog diff changed.");
  }
  const result = new ModelRegistryUpdateService().update({
    catalogPath: record.catalogPath,
    workspacePath: workspace.workspacePath,
    apply: true,
  });

  return {
    schemaVersion: "2",
    kind: "model_registry_update_result",
    applied: true,
    homeRegistryPath: result.homeRegistryPath,
    workspaceRegistryPath: result.workspaceRegistryPath,
    diff: result.diff,
  };
}
