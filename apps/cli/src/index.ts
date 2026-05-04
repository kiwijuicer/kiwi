import { Command } from "commander";
import { runA2AReceive } from "./commands/a2a";
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
import { runWorkspaceList } from "./commands/workspace";

const program = new Command();

program
  .name("kiwi")
  .description("ai-kiwi local-first control plane")
  .version("0.1.0")
  .option("--workspace <path>", "Workspace control root")
  .option("--repo <idOrPath>", "Target repo inside the workspace");

function addWorkspaceOptions(command: Command): Command {
  return command
    .option("--workspace <path>", "Workspace control root")
    .option("--repo <idOrPath>", "Target repo inside the workspace");
}

function withGlobalWorkspaceOptions<T extends { workspace?: string; repo?: string }>(opts: T): T {
  const global = program.opts<{ workspace?: string; repo?: string }>();
  const merged: T = { ...opts };
  const workspace = opts.workspace ?? global.workspace;
  const repo = opts.repo ?? global.repo;
  if (workspace) merged.workspace = workspace;
  if (repo) merged.repo = repo;
  return merged;
}

program
  .command("init")
  .description("Initialize ai-kiwi in current directory")
  .option("-f, --force", "Regenerate initialization files")
  .option("--workspace <path>", "Workspace control root to initialize")
  .action((opts: { force?: boolean; workspace?: string }) => {
    runInit(withGlobalWorkspaceOptions(opts)).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

addWorkspaceOptions(
  program
  .command("plan <ticket>")
  .description("Generate deterministic TaskGraph from ticket")
  .option("--dry-run", "Print generated plan without writing files")
  .option("--risk-profile <profile>", "local|dev|staging|production", "dev")
  .option("--budget-profile <profile>", "tiny|small|normal|large|critical", "normal"),
)
  .action(
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
      runPlan(ticket, withGlobalWorkspaceOptions(opts)).catch((error: Error) => {
        console.error(`\n✗ ${error.message}`);
        process.exit(1);
      });
    },
  );

const workspaceCommand = program.command("workspace").description("Workspace discovery commands");
workspaceCommand
  .command("list")
  .description("List repos detected for a workspace")
  .option("--workspace <path>", "Workspace control root")
  .option("--repo <idOrPath>", "Target repo inside the workspace")
  .action((opts: { workspace?: string; repo?: string }) => {
    runWorkspaceList(withGlobalWorkspaceOptions(opts)).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

addWorkspaceOptions(
  program
  .command("status [runId]")
  .description("Show summary for stored runs"),
)
  .action((runId?: string, opts?: { workspace?: string; repo?: string }) => {
    runStatus(process.cwd(), runId, withGlobalWorkspaceOptions(opts ?? {})).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

addWorkspaceOptions(
  program
  .command("attempt <runId> <stepId>")
  .description("Execute one planned step attempt")
  .option("--command <command>", "Command to run in the isolated worktree")
  .option("--approved", "Treat approval-required policy checks as approved"),
)
  .action((runId: string, stepId: string, opts: { command?: string; approved?: boolean; workspace?: string; repo?: string }) => {
    runAttempt(runId, stepId, withGlobalWorkspaceOptions(opts)).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

addWorkspaceOptions(
  program
  .command("run <runId>")
  .description("Execute planned steps in order")
  .option("--from-step <stepId>", "Start at a specific step")
  .option("--command <command>", "Command to run for each step")
  .option("--approved", "Treat approval-required policy checks as approved"),
)
  .action((runId: string, opts: { fromStep?: string; command?: string; approved?: boolean; workspace?: string; repo?: string }) => {
    runRun(runId, withGlobalWorkspaceOptions(opts)).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

addWorkspaceOptions(
  program
  .command("approve <runId> <attemptId>")
  .description("Record approval for an attempt")
  .option("--reason <reason>", "Approval reason")
  .option("--approved-by <name>", "Approver name"),
)
  .action((runId: string, attemptId: string, opts: { reason?: string; approvedBy?: string; workspace?: string; repo?: string }) => {
    runApprove(runId, attemptId, withGlobalWorkspaceOptions(opts)).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

addWorkspaceOptions(
  program
  .command("finalize <runId>")
  .description("Write final run verdict, summary, and cost report"),
)
  .action((runId: string, opts: { workspace?: string; repo?: string }) => {
    runFinalize(runId, withGlobalWorkspaceOptions(opts)).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

const evidenceCommand = program.command("evidence").description("Evidence artifact commands");
addWorkspaceOptions(
  evidenceCommand
  .command("manifest <runId>")
  .description("Write evidence manifest and audit snapshot for a run"),
)
  .action((runId: string, opts: { workspace?: string; repo?: string }) => {
    runEvidenceManifest(runId, withGlobalWorkspaceOptions(opts)).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

const operatorCommand = program.command("operator").description("Operator surface commands");
addWorkspaceOptions(
  operatorCommand
  .command("snapshot <runId>")
  .description("Write local operator HTML snapshot for a run"),
)
  .action((runId: string, opts: { workspace?: string; repo?: string }) => {
    runOperatorSnapshot(runId, withGlobalWorkspaceOptions(opts)).catch((error: Error) => {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    });
  });

const a2aCommand = program.command("a2a").description("A2A protocol commands");
addWorkspaceOptions(
  a2aCommand
  .command("receive <envelope>")
  .description("Validate and optionally accept an A2A envelope into the local loopback inbox")
  .option("--loopback", "Enable local loopback receive mode")
  .option("--local-agent <id>", "Local A2A agent identity", "ai-kiwi-local")
  .option("--trusted-agent <ids>", "Comma-separated trusted sender agent ids"),
)
  .action(
    (
      envelope: string,
      opts: {
        loopback?: boolean;
        localAgent?: string;
        trustedAgent?: string;
        workspace?: string;
        repo?: string;
      },
    ) => {
      runA2AReceive(envelope, withGlobalWorkspaceOptions(opts)).catch((error: Error) => {
        console.error(`\n✗ ${error.message}`);
        process.exit(1);
      });
    },
  );

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
