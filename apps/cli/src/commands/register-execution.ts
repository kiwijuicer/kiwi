import { Command } from "commander";
import { runApprove } from "./approve";
import { runAttempt } from "./attempt";
import { runEvidenceManifest } from "./evidence";
import { runFinalize } from "./finalize";
import { runOperatorSnapshot } from "./operator";
import { runPublishPr } from "./publish";
import { runRun } from "./run";
import { addWorkspaceOptions, handleCommandError, WorkspaceOptionMerger } from "./register-common";

export function registerExecutionCommands(program: Command, withWorkspaceOptions: WorkspaceOptionMerger): void {
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

  addWorkspaceOptions(
    program
      .command("run <runId>")
      .description("Execute planned steps in order")
      .option("--from-step <stepId>", "Start at a specific step")
      .option("--command <command>", "Command to run for each step")
      .option("--approved", "Treat approval-required policy checks as approved"),
  ).action(
    (
      runId: string,
      opts: { fromStep?: string; command?: string; approved?: boolean; workspace?: string; repo?: string },
    ) => {
      runRun(runId, withWorkspaceOptions(opts)).catch(handleCommandError);
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
