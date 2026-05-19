import { existsSync } from "fs";
import path from "path";
import chalk from "chalk";
import { loadEffectiveRegistry, ModelRegistryUpdateService, type ModelRegistryUpdateResult } from "@kiwi/core";
import { evaluateAccessModeAvailability, modelAccessConfigured } from "@kiwi/runtime";
import { resolveCliWorkspace, type CliWorkspaceOptions } from "../../workspace/options";

interface ModelsUpdateOptions extends CliWorkspaceOptions {
  apply?: boolean;
  json?: boolean;
  catalogPath?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
}

interface ModelsListOptions extends CliWorkspaceOptions {
  json?: boolean;
  env?: Record<string, string | undefined>;
}

class ModelsUpdateCommand {
  private catalogPathCandidates(configured: string | undefined): string[] {
    return [
      ...(configured ? [configured] : []),
      ...(process.env.KIWI_MODEL_CATALOG_PATH ? [process.env.KIWI_MODEL_CATALOG_PATH] : []),
      path.resolve(__dirname, "../../../config/model-catalog.json"),
      path.resolve(__dirname, "../../../../../config/model-catalog.json"),
      path.resolve(process.cwd(), "config/model-catalog.json"),
    ];
  }

  private resolveCatalogPath(configured: string | undefined): string {
    for (const candidate of this.catalogPathCandidates(configured)) {
      const resolved = path.resolve(candidate);

      if (existsSync(resolved)) {
        return resolved;
      }
    }

    throw new Error("Model catalog not found. Set KIWI_MODEL_CATALOG_PATH or run from a kiwi release checkout.");
  }

  private formatValues(values: string[]): string {
    return values.length > 0 ? values.join(", ") : "-";
  }

  private printHuman(result: ModelRegistryUpdateResult): void {
    console.log((result.applied ? chalk.green("✓") : chalk.yellow("•")) + " Model registry update");
    console.log(chalk.dim(`catalog: ${result.diff.catalogVersion}`));
    console.log(chalk.dim(`home: ${result.homeRegistryPath}`));
    if (result.workspaceRegistryPath) {
      console.log(chalk.dim(`workspace override: ${result.workspaceRegistryPath}`));
    }
    if (!result.applied) {
      console.log(chalk.dim("mode: dry-run; rerun with --apply to write home defaults"));
    }
    console.log(`added: ${this.formatValues(result.diff.addedModelIds)}`);
    console.log(`removed: ${this.formatValues(result.diff.removedModelIds)}`);
    console.log(`pricing changed: ${this.formatValues(result.diff.pricingChanges)}`);
    console.log(`disabled: ${this.formatValues(result.diff.disabledModelIds)}`);
    console.log(`deprecated: ${this.formatValues(result.diff.deprecatedModelIds)}`);
    if (result.diff.providerModelChanges.length > 0) {
      console.log("provider model changes:");
      for (const change of result.diff.providerModelChanges) {
        console.log(`  ${change.modelId}: ${change.before ?? "-"} -> ${change.after ?? "-"}`);
      }
    } else {
      console.log("provider model changes: -");
    }
    if (result.diff.workspaceOverrideConflicts.length > 0) {
      console.log(chalk.yellow(`workspace overrides: ${this.formatValues(result.diff.workspaceOverrideConflicts)}`));
    }
  }

  async run(opts: ModelsUpdateOptions = {}, cwd: string = process.cwd()): Promise<void> {
    const workspace = resolveCliWorkspace(opts, cwd, false);
    const result = new ModelRegistryUpdateService().update({
      catalogPath: this.resolveCatalogPath(opts.catalogPath),
      workspacePath: workspace.workspacePath,
      apply: opts.apply === true,
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));

      return;
    }

    this.printHuman(result);
  }
}

const modelsUpdateCommand = new ModelsUpdateCommand();

class ModelsListCommand {
  private snapshot(opts: ModelsListOptions, cwd: string): Record<string, unknown> {
    const env = opts.env ?? process.env;
    const workspace = resolveCliWorkspace(opts, cwd, false);
    const registry = loadEffectiveRegistry(workspace.workspacePath, { env });
    const models = registry.models.map((model) => {
      const availability = evaluateAccessModeAvailability(model.accessMode, env);
      const configured = modelAccessConfigured(model);

      const accessAvailable = configured.configured && availability.available;

      return {
        id: model.id,
        provider: model.provider,
        providerModel: model.providerModel ?? null,
        capability: model.capability,
        roles: model.roles,
        accessMode: model.accessMode,
        enabled: model.enabled,
        accessAvailable,
        accessReason: configured.configured ? (availability.reason ?? null) : (configured.reason ?? null),
        pricing: {
          currency: model.pricing.currency,
          inputUsdPerMillion: model.pricing.inputUsdPerMillion,
          cacheReadUsdPerMillion: model.pricing.cacheReadUsdPerMillion ?? null,
          outputUsdPerMillion: model.pricing.outputUsdPerMillion,
          source: model.pricing.source ?? null,
          sourceVersion: model.pricing.sourceVersion ?? null,
          pricingLastVerifiedAt: model.pricing.pricingLastVerifiedAt ?? null,
        },
        deprecatedAt: model.deprecatedAt ?? null,
        replacementModelId: model.replacementModelId ?? null,
      };
    });

    return {
      schemaVersion: "1",
      workspacePath: workspace.workspacePath,
      catalogVersion: registry.catalogVersion ?? null,
      models,
    };
  }

  private printHuman(snapshot: Record<string, unknown>): void {
    const models = snapshot.models as Array<{
      id: string;
      providerModel: string | null;
      capability: string;
      accessMode: string;
      enabled: boolean;
      accessAvailable: boolean;
      accessReason: string | null;
      pricing: {
        inputUsdPerMillion: number;
        outputUsdPerMillion: number;
        sourceVersion: string | null;
        pricingLastVerifiedAt: string | null;
      };
    }>;

    console.log(chalk.bold("kiwi models"));
    console.log(chalk.dim(`workspace: ${String(snapshot.workspacePath)}`));
    console.log(chalk.dim(`catalog: ${String(snapshot.catalogVersion ?? "-")}`));
    for (const model of models) {
      const enabled = model.enabled ? chalk.green("enabled") : chalk.dim("disabled");
      const available = model.accessAvailable ? chalk.green("available") : chalk.yellow("unavailable");
      const reason = model.accessReason ? chalk.dim(` (${model.accessReason})`) : "";
      const pricing = `$${model.pricing.inputUsdPerMillion}/$${model.pricing.outputUsdPerMillion} per 1M in/out`;

      console.log(`${model.id}  ${model.capability}  ${model.accessMode}  ${enabled}  ${available}${reason}`);
      console.log(
        chalk.dim(
          `  providerModel=${model.providerModel ?? "-"} pricing=${pricing} verified=${model.pricing.pricingLastVerifiedAt ?? "-"}`,
        ),
      );
    }
  }

  async run(opts: ModelsListOptions = {}, cwd: string = process.cwd()): Promise<void> {
    const snapshot = this.snapshot(opts, cwd);

    if (opts.json) {
      console.log(JSON.stringify(snapshot, null, 2));

      return;
    }

    this.printHuman(snapshot);
  }
}

const modelsListCommand = new ModelsListCommand();

export async function runModelsUpdate(opts: ModelsUpdateOptions = {}, cwd: string = process.cwd()): Promise<void> {
  await modelsUpdateCommand.run(opts, cwd);
}

export async function runModelsList(opts: ModelsListOptions = {}, cwd: string = process.cwd()): Promise<void> {
  await modelsListCommand.run(opts, cwd);
}
