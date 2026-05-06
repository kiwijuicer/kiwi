import { Command } from "commander";
import { runCost } from "./cost";
import { runDoctor } from "./doctor";
import { runExplain } from "./explain";
import { runInit } from "./init";
import { runPlan } from "./plan";
import { runRulesSync } from "./rules";
import { runStatus } from "./status";
import { runWorkspaceList } from "./workspace";
import { addWorkspaceOptions, handleCommandError, WorkspaceOptionMerger } from "./register-common";

export function registerCoreCommands(program: Command, withWorkspaceOptions: WorkspaceOptionMerger): void {
  program
    .command("init")
    .description("Initialize kiwi in current directory")
    .option("-f, --force", "Regenerate initialization files")
    .option("--mcp <target>", "Write MCP client config: none|cursor|claude|codex|all", "none")
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
        riskProfile?: "local" | "dev" | "staging" | "production";
        budgetProfile?: "tiny" | "small" | "normal" | "large" | "critical";
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

  addWorkspaceOptions(
    program.command("status [runId]").description("Show summary for stored runs").option("--json", "Print JSON"),
  ).action((runId?: string, opts?: { workspace?: string; repo?: string; json?: boolean }) => {
    runStatus(process.cwd(), runId, withWorkspaceOptions(opts ?? {})).catch(handleCommandError);
  });

  addWorkspaceOptions(
    program
      .command("cost <runId>")
      .description("Show run cost and model summary")
      .option("--json", "Print JSON")
      .option("--csv", "Write final cost CSV to run artifacts"),
  ).action((runId: string, opts: { workspace?: string; repo?: string; json?: boolean; csv?: boolean }) => {
    runCost(runId, withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  addWorkspaceOptions(
    program
      .command("explain <runId>")
      .description("Show routing, gate, cost, and next action")
      .option("--json", "Print JSON"),
  ).action((runId: string, opts: { workspace?: string; repo?: string; json?: boolean }) => {
    runExplain(runId, withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  addWorkspaceOptions(
    program.command("doctor").description("Probe configured policies, registry entries, and available access modes"),
  ).action((opts: { workspace?: string; repo?: string }) => {
    runDoctor(withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  program
    .command("rules sync")
    .description("Generate editor rule files from canonical project rules")
    .option("--target <target>", "cursor", "cursor")
    .action((opts: { target?: string }) => {
      runRulesSync(opts).catch(handleCommandError);
    });
}
