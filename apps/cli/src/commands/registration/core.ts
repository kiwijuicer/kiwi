import { Command } from "commander/esm.mjs";
import type { BudgetProfile, RiskProfile } from "@kiwi/contracts";
import { runCost } from "../runs/cost.js";
import { runConfigSetApprover } from "../setup/config.js";
import { runDoctor } from "../setup/doctor.js";
import { runExplain } from "../planning/explain.js";
import { runInit } from "../setup/init.js";
import { runModelsList, runModelsUpdate } from "../setup/models.js";
import { runPlan } from "../planning/plan.js";
import { runRulesSync } from "../setup/rules.js";
import { runStatus } from "../runs/status.js";
import { runWorkspaceList } from "../setup/workspace.js";
import { addWorkspaceOptions, handleCommandError, WorkspaceOptionMerger } from "./common.js";

const JSON_OPTION_DESCRIPTION = "Print JSON";

export function registerCoreCommands(program: Command, withWorkspaceOptions: WorkspaceOptionMerger): void {
  program
    .command("init")
    .description("Initialize kiwi in current directory")
    .option("-f, --force", "Regenerate initialization files")
    .option("--mcp <target>", "Write MCP client config: none|cursor|claude|codex|all", "all")
    .option("--workspace <path>", "Workspace control root to initialize")
    .action((opts: { force?: boolean; mcp?: string; workspace?: string }) => {
      runInit(withWorkspaceOptions(opts)).catch(handleCommandError);
    });

  addWorkspaceOptions(
    program
      .command("plan <ticket>")
      .description("Generate deterministic TaskGraph from ticket")
      .option("--dry-run", "Print generated plan without writing files")
      .option("--risk-profile <profile>", "local|dev|staging|production", "dev")
      .option("--budget-profile <profile>", "tiny|small|normal|large|critical", "normal"),
  ).action(
    (
      ticket: string,
      opts: {
        dryRun?: boolean;
        workspace?: string;
        repo?: string;
        riskProfile?: RiskProfile;
        budgetProfile?: BudgetProfile;
      },
    ) => {
      runPlan(ticket, withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );

  const workspaceCommand = program.command("workspace").description("Workspace discovery commands");
  workspaceCommand
    .command("list")
    .description("List repos detected for a workspace")
    .option("--workspace <path>", "Workspace control root")
    .option("--repo <idOrPath>", "Target repo inside the workspace")
    .action((opts: { workspace?: string; repo?: string }) => {
      runWorkspaceList(withWorkspaceOptions(opts)).catch(handleCommandError);
    });

  const configCommand = program.command("config").description("Workspace configuration commands");
  const configSetCommand = configCommand.command("set").description("Set workspace configuration values");
  addWorkspaceOptions(
    configSetCommand.command("approver <identity>").description("Set default MCP approval identity"),
  ).action((identity: string, opts: { workspace?: string; repo?: string }) => {
    runConfigSetApprover(identity, withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  addWorkspaceOptions(
    program
      .command("status [runId]")
      .description("Show summary for stored runs")
      .option("--json", JSON_OPTION_DESCRIPTION)
      .option("--verbose", "Show attempts, subplans, and artifact paths"),
  ).action((runId?: string, opts?: { workspace?: string; repo?: string; json?: boolean; verbose?: boolean }) => {
    runStatus(process.cwd(), runId, withWorkspaceOptions(opts ?? {})).catch(handleCommandError);
  });

  addWorkspaceOptions(
    program
      .command("cost <runId>")
      .description("Show run cost and model summary")
      .option("--json", JSON_OPTION_DESCRIPTION)
      .option("--csv", "Write final cost CSV to run artifacts"),
  ).action((runId: string, opts: { workspace?: string; repo?: string; json?: boolean; csv?: boolean }) => {
    runCost(runId, withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  addWorkspaceOptions(
    program
      .command("explain <runId>")
      .description("Show routing, gate, cost, and next action")
      .option("--json", JSON_OPTION_DESCRIPTION),
  ).action((runId: string, opts: { workspace?: string; repo?: string; json?: boolean }) => {
    runExplain(runId, withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  addWorkspaceOptions(
    program.command("doctor").description("Probe configured policies, registry entries, and available access modes"),
  ).action((opts: { workspace?: string; repo?: string }) => {
    runDoctor(withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  const modelsCommand = program.command("models").description("Model catalog and registry commands");
  addWorkspaceOptions(
    modelsCommand
      .command("list")
      .description("List effective model registry entries")
      .option("--json", JSON_OPTION_DESCRIPTION),
  ).action((opts: { workspace?: string; repo?: string; json?: boolean }) => {
    runModelsList(withWorkspaceOptions(opts)).catch(handleCommandError);
  });
  addWorkspaceOptions(
    modelsCommand
      .command("update")
      .description("Update home model registry from the curated release catalog")
      .option("--apply", "Write ~/.kiwi/defaults/model-registry.yaml")
      .option("--json", JSON_OPTION_DESCRIPTION)
      .option("--catalog-path <path>", "Read a specific model catalog file"),
  ).action((opts: { workspace?: string; repo?: string; apply?: boolean; json?: boolean; catalogPath?: string }) => {
    runModelsUpdate(withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  program
    .command("rules sync")
    .description("Generate editor rule files from canonical project rules")
    .option("--target <target>", "cursor", "cursor")
    .action((opts: { target?: string }) => {
      runRulesSync(opts).catch(handleCommandError);
    });
}
