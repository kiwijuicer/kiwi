import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import chalk from "chalk";
import {
  DEFAULT_MODEL_REGISTRY_YAML,
  DEFAULT_POLICY_YAML,
  defaultKiwiConfigYaml,
} from "../default-config";

export interface InitOptions {
  force?: boolean;
  workspace?: string;
}

export async function runInit(
  opts: InitOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const targetCwd = opts.workspace ? path.resolve(cwd, opts.workspace) : cwd;
  if (!existsSync(targetCwd)) {
    throw new Error(`Workspace path not found: ${targetCwd}`);
  }
  const kiwiDir = path.join(targetCwd, ".kiwi");
  const configPath = path.join(kiwiDir, "config.yaml");
  const policyPath = path.join(targetCwd, "kiwi-policy.yaml");
  const registryPath = path.join(targetCwd, "model-registry.yaml");

  mkdirSync(path.join(kiwiDir, "runs"), { recursive: true });
  mkdirSync(path.join(kiwiDir, "logs"), { recursive: true });

  const shouldWriteConfig = !existsSync(configPath) || Boolean(opts.force);
  if (shouldWriteConfig) {
    writeFileSync(configPath, defaultKiwiConfigYaml(new Date().toISOString()), "utf-8");
  }

  const shouldWritePolicy = !existsSync(policyPath) || Boolean(opts.force);
  const shouldWriteRegistry = !existsSync(registryPath) || Boolean(opts.force);

  if (shouldWritePolicy) {
    writeFileSync(policyPath, DEFAULT_POLICY_YAML, "utf-8");
  }
  if (shouldWriteRegistry) {
    writeFileSync(registryPath, DEFAULT_MODEL_REGISTRY_YAML, "utf-8");
  }

  console.log(chalk.green("✓") + " .kiwi initialized");
  console.log(chalk.dim(`workspace: ${targetCwd}`));
  if (!shouldWriteConfig) console.log(chalk.gray("•") + " .kiwi/config.yaml preserved");
  if (!shouldWritePolicy) console.log(chalk.gray("•") + " kiwi-policy.yaml preserved");
  if (!shouldWriteRegistry) console.log(chalk.gray("•") + " model-registry.yaml preserved");
  if (shouldWriteConfig) console.log(chalk.green("✓") + " .kiwi/config.yaml written");
  if (shouldWritePolicy) console.log(chalk.green("✓") + " kiwi-policy.yaml written");
  if (shouldWriteRegistry) console.log(chalk.green("✓") + " model-registry.yaml written");
}
