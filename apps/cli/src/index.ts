import { Command } from "commander";
import { runApprove } from "./commands/approve";
import { runAttempt } from "./commands/attempt";
import { runEvidenceManifest } from "./commands/evidence";
import { runFinalize } from "./commands/finalize";
import { runInit } from "./commands/init";
import { runOperatorSnapshot } from "./commands/operator";
import { runPlan } from "./commands/plan";
import { runRun } from "./commands/run";
import { runRulesSync } from "./commands/rules";
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

program
  .command("attempt <runId> <stepId>")
  .description("Execute one planned step attempt")
  .option("--command <command>", "Command to run in the isolated worktree")
  .option("--approved", "Treat approval-required policy checks as approved")
  .action((runId: string, stepId: string, opts: { command?: string; approved?: boolean }) => {
    runAttempt(runId, stepId, opts).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

program
  .command("run <runId>")
  .description("Execute planned steps in order")
  .option("--from-step <stepId>", "Start at a specific step")
  .option("--command <command>", "Command to run for each step")
  .option("--approved", "Treat approval-required policy checks as approved")
  .action((runId: string, opts: { fromStep?: string; command?: string; approved?: boolean }) => {
    runRun(runId, opts).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

program
  .command("approve <runId> <attemptId>")
  .description("Record approval for an attempt")
  .option("--reason <reason>", "Approval reason")
  .option("--approved-by <name>", "Approver name")
  .action((runId: string, attemptId: string, opts: { reason?: string; approvedBy?: string }) => {
    runApprove(runId, attemptId, opts).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

program
  .command("finalize <runId>")
  .description("Write final run verdict, summary, and cost report")
  .action((runId: string) => {
    runFinalize(runId).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

program
  .command("evidence manifest <runId>")
  .description("Write evidence manifest and audit snapshot for a run")
  .action((runId: string) => {
    runEvidenceManifest(runId).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

program
  .command("operator snapshot <runId>")
  .description("Write local operator HTML snapshot for a run")
  .action((runId: string) => {
    runOperatorSnapshot(runId).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

program
  .command("rules sync")
  .description("Generate editor rule files from canonical project rules")
  .option("--target <target>", "cursor", "cursor")
  .action((opts: { target?: string }) => {
    runRulesSync(opts).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

program.parse();
