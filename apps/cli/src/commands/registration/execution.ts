import { Command } from "commander";
import { runApprove } from "../execution/approve";
import { runAttempt } from "../execution/attempt";
import { runApply, runDiff } from "../execution/diff";
import { runEvidenceManifest } from "../execution/evidence";
import { runFeedback } from "../execution/feedback";
import { runFinalize } from "../execution/finalize";
import { runOperatorSnapshot } from "../operations/operator";
import { runPublishPr } from "../operations/publish";
import { runRun } from "../runs/run";
import { runTail } from "../runs/tail";
import { addWorkspaceOptions, handleCommandError, WorkspaceOptionMerger } from "./common";

function registerDiffApplyCommands(program: Command, withWorkspaceOptions: WorkspaceOptionMerger): void {
  addWorkspaceOptions(
    program
      .command("diff <runId> [stepId]")
      .description("Show persisted attempt patch stat and diff")
      .option("--json", "Print JSON")
      .option("--all", "Include all attempts instead of latest attempts"),
  ).action(
    (
      runId: string,
      stepId: string | undefined,
      opts: { workspace?: string; repo?: string; json?: boolean; all?: boolean },
    ) => {
      runDiff(runId, stepId, withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );

  addWorkspaceOptions(
    program
      .command("apply <runId> [stepId]")
      .description("Apply a persisted worktree patch to the source repo")
      .option("--force-unsafe", "Apply even when review verdict blocks it")
      .option("--json", "Print JSON"),
  ).action(
    (
      runId: string,
      stepId: string | undefined,
      opts: { workspace?: string; repo?: string; forceUnsafe?: boolean; json?: boolean },
    ) => {
      runApply(runId, stepId, withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );
}

function registerRunCommand(program: Command, withWorkspaceOptions: WorkspaceOptionMerger): void {
  addWorkspaceOptions(
    program
      .command("run <runId>")
      .description("Execute planned steps in order")
      .allowExcessArguments(false)
      .option("--from-step <stepId>", "Start at a specific step")
      .option("--max-concurrency <number>", "Maximum parallel attempts when subplans are available", (value) =>
        Number.parseInt(value, 10),
      )
      .option("--max-cost <usd>", "Abort before execution if forecast exceeds this USD cap", (value) =>
        Number.parseFloat(value),
      )
      .option("--command <command>", "Command to run for each step")
      .option("--approved", "Treat approval-required policy checks as approved")
      .option("--auto-fix", "On needs_changes verdict, inject a fix step and continue")
      .option("--auto-replan", "On reject verdict, write a versioned plan and stop with a hint"),
  ).action(
    (
      runId: string,
      opts: {
        fromStep?: string;
        maxConcurrency?: number;
        maxCost?: number;
        command?: string;
        approved?: boolean;
        autoFix?: boolean;
        autoReplan?: boolean;
        workspace?: string;
        repo?: string;
      },
    ) => {
      runRun(runId, withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );
}

function registerTailCommand(program: Command, withWorkspaceOptions: WorkspaceOptionMerger): void {
  addWorkspaceOptions(
    program
      .command("tail <runId>")
      .description("Tail audit events for a run")
      .option("--phase <phase>", "Filter by phase or event type")
      .option("--since <time>", "Filter from ISO timestamp or relative duration like 10m")
      .option("--no-follow", "Print current matching events and exit")
      .option("--no-color", "Disable colored output"),
  ).action(
    (
      runId: string,
      opts: { phase?: string; since?: string; follow?: boolean; color?: boolean; workspace?: string; repo?: string },
    ) => {
      runTail(runId, withWorkspaceOptions({ ...opts, noColor: opts.color === false })).catch(handleCommandError);
    },
  );
}

export function registerExecutionCommands(program: Command, withWorkspaceOptions: WorkspaceOptionMerger): void {
  registerDiffApplyCommands(program, withWorkspaceOptions);

  addWorkspaceOptions(
    program
      .command("attempt <runId> <stepId>")
      .description("Execute one planned step attempt")
      .option("--command <command>", "Command to run in the isolated worktree")
      .option("--approved", "Treat approval-required policy checks as approved"),
  ).action(
    (
      runId: string,
      stepId: string,
      opts: { command?: string; approved?: boolean; workspace?: string; repo?: string },
    ) => {
      runAttempt(runId, stepId, withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );

  registerRunCommand(program, withWorkspaceOptions);
  registerTailCommand(program, withWorkspaceOptions);

  addWorkspaceOptions(
    program
      .command("feedback [runId]")
      .description("Record human feedback and replan the active run")
      .requiredOption("--message <text>", "Human feedback or requested adjustment")
      .option("--author <name>", "Feedback author")
      .option("--target-step <stepId>", "Step the feedback targets")
      .option("--target-attempt <attemptId>", "Attempt the feedback targets")
      .option("--json", "Print JSON"),
  ).action(
    (
      runId: string | undefined,
      opts: {
        message: string;
        author?: string;
        targetStep?: string;
        targetAttempt?: string;
        json?: boolean;
        workspace?: string;
        repo?: string;
      },
    ) => {
      runFeedback(runId, withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );

  addWorkspaceOptions(
    program
      .command("approve <runId> <attemptId>")
      .description("Record approval for an attempt")
      .option("--reason <reason>", "Approval reason")
      .option("--approved-by <name>", "Approver name"),
  ).action(
    (
      runId: string,
      attemptId: string,
      opts: { reason?: string; approvedBy?: string; workspace?: string; repo?: string },
    ) => {
      runApprove(runId, attemptId, withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );

  addWorkspaceOptions(
    program.command("finalize <runId>").description("Write final run verdict, summary, and cost report"),
  ).action((runId: string, opts: { workspace?: string; repo?: string }) => {
    runFinalize(runId, withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  const evidenceCommand = program.command("evidence").description("Evidence artifact commands");
  addWorkspaceOptions(
    evidenceCommand.command("manifest <runId>").description("Write evidence manifest and audit snapshot for a run"),
  ).action((runId: string, opts: { workspace?: string; repo?: string }) => {
    runEvidenceManifest(runId, withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  const operatorCommand = program.command("operator").description("Operator surface commands");
  addWorkspaceOptions(
    operatorCommand.command("snapshot <runId>").description("Write local operator HTML snapshot for a run"),
  ).action((runId: string, opts: { workspace?: string; repo?: string }) => {
    runOperatorSnapshot(runId, withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  const publishCommand = program.command("publish").description("Publish local draft artifacts");
  addWorkspaceOptions(
    publishCommand
      .command("pr <runId>")
      .description("Push a local Bitbucket branch and write a PR draft artifact")
      .option("--remote <remote>", "Git remote to push", "origin")
      .option("--target-branch <branch>", "Pull request target branch", "main")
      .option("--branch-name <branch>", "Override source branch name"),
  ).action(
    (
      runId: string,
      opts: { remote?: string; targetBranch?: string; branchName?: string; workspace?: string; repo?: string },
    ) => {
      runPublishPr(runId, withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );
}
