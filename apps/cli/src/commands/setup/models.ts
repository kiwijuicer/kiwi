import { existsSync } from "fs";
import path from "path";
import chalk from "chalk";
import { ModelRegistryUpdateService, type ModelRegistryUpdateResult } from "@kiwi/core";
import { resolveCliWorkspace, type CliWorkspaceOptions } from "../../workspace/options";

interface ModelsUpdateOptions extends CliWorkspaceOptions {
  apply?: boolean;
  json?: boolean;
  catalogPath?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
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

export async function runModelsUpdate(opts: ModelsUpdateOptions = {}, cwd: string = process.cwd()): Promise<void> {
  await modelsUpdateCommand.run(opts, cwd);
}
