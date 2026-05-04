import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import chalk from "chalk";

export interface RulesSyncOptions {
  target?: string;
}

function targetName(fileName: string): string {
  return fileName.replace(/\.md$/i, ".mdc");
}

function writeCursorRule(params: { sourcePath: string; targetPath: string; description: string }): void {
  const body = readFileSync(params.sourcePath, "utf-8");
  const content = ["---", `description: ${params.description}`, "alwaysApply: true", "---", "", body].join("\n");
  writeFileSync(params.targetPath, content, "utf-8");
}

export async function runRulesSync(opts: RulesSyncOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const target = opts.target ?? "cursor";
  if (target !== "cursor") {
    throw new Error(`Unsupported rules sync target: ${target}`);
  }

  const agentsPath = path.join(cwd, "AGENTS.md");
  const rulesDir = path.join(cwd, "docs", "rules");
  if (!existsSync(agentsPath)) throw new Error("AGENTS.md not found");
  if (!existsSync(rulesDir)) throw new Error("docs/rules not found");

  const cursorRulesDir = path.join(cwd, ".cursor", "rules");
  mkdirSync(cursorRulesDir, { recursive: true });
  writeCursorRule({
    sourcePath: agentsPath,
    targetPath: path.join(cursorRulesDir, "agents.mdc"),
    description: "kiwi canonical agent entrypoint",
  });

  const ruleFiles = readdirSync(rulesDir)
    .filter((entry) => entry.endsWith(".md"))
    .sort();
  for (const fileName of ruleFiles) {
    writeCursorRule({
      sourcePath: path.join(rulesDir, fileName),
      targetPath: path.join(cursorRulesDir, targetName(fileName)),
      description: `kiwi ${fileName.replace(/\.md$/i, "")} rules`,
    });
  }

  console.log(chalk.green("✓") + " Rules synced");
  console.log(chalk.dim(`target: ${target}`));
  console.log(chalk.dim(`files: ${ruleFiles.length + 1}`));
}
