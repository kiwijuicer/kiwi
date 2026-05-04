import { Command } from "commander";
import { runInit } from "./commands/init";
import { runPlan } from "./commands/plan";
import { runStatus } from "./commands/status";

const program = new Command();

program.name("kiwi").description("ai-kiwi local-first control plane").version("0.1.0");

program
  .command("init")
  .description("Initialize ai-kiwi in current directory")
  .option("-f, --force", "Regenerate initialization files")
  .action((opts: { force?: boolean }) => {
    runInit(opts).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

program
  .command("plan <ticket>")
  .description("Generate deterministic TaskGraph from ticket")
  .option("--dry-run", "Print generated plan without writing files")
  .option("--risk-profile <profile>", "local|dev|staging|production", "dev")
  .option("--budget-profile <profile>", "tiny|small|normal|large|critical", "normal")
  .action(
    (
      ticket: string,
      opts: {
        dryRun?: boolean;
        riskProfile?: "local" | "dev" | "staging" | "production";
        budgetProfile?: "tiny" | "small" | "normal" | "large" | "critical";
      },
    ) => {
      runPlan(ticket, opts).catch((error: Error) => {
        console.error(`\n✗ ${error.message}`);
        process.exit(1);
      });
    },
  );

program
  .command("status [runId]")
  .description("Show summary for stored runs")
  .action((runId?: string) => {
    runStatus(process.cwd(), runId).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

program.parse();
