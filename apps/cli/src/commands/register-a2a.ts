import { Command } from "commander";
import {
  runA2AAccept,
  runA2ADisable,
  runA2AEnable,
  runA2AIdentity,
  runA2AInbox,
  runA2APublish,
  runA2AReceive,
  runA2ASync,
  runA2ATrustAdd,
  runA2ATrustList,
  runA2ATrustRemove,
} from "./a2a";
import { addWorkspaceOptions, handleCommandError, WorkspaceOptionMerger } from "./register-common";

export function registerA2ACommands(program: Command, withWorkspaceOptions: WorkspaceOptionMerger): void {
  const a2aCommand = program.command("a2a").description("A2A protocol commands");
  addWorkspaceOptions(
    a2aCommand
      .command("enable")
      .description("Enable filesystem A2A for this workspace")
      .option("--local-agent <id>", "Local A2A agent identity"),
  ).action((opts: { localAgent?: string; workspace?: string; repo?: string }) => {
    runA2AEnable(withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  addWorkspaceOptions(a2aCommand.command("disable").description("Disable filesystem A2A for this workspace")).action(
    (opts: { workspace?: string; repo?: string }) => {
      runA2ADisable(withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );

  addWorkspaceOptions(a2aCommand.command("identity").description("Show local A2A identity and incoming path")).action(
    (opts: { workspace?: string; repo?: string }) => {
      runA2AIdentity(withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );

  const a2aTrustCommand = a2aCommand.command("trust").description("A2A trust configuration");
  addWorkspaceOptions(
    a2aTrustCommand
      .command("add <agentId>")
      .description("Trust an A2A peer")
      .requiredOption("--inbox-path <path>", "Peer .kiwi/a2a/transport/incoming path")
      .option("--allow-remote-patches", "Allow remote patch artifacts into inbox instead of quarantine"),
  ).action(
    (agentId: string, opts: { inboxPath: string; allowRemotePatches?: boolean; workspace?: string; repo?: string }) => {
      runA2ATrustAdd(agentId, withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );

  addWorkspaceOptions(a2aTrustCommand.command("list").description("List trusted A2A peers")).action(
    (opts: { workspace?: string; repo?: string }) => {
      runA2ATrustList(withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );

  addWorkspaceOptions(a2aTrustCommand.command("remove <agentId>").description("Remove a trusted A2A peer")).action(
    (agentId: string, opts: { workspace?: string; repo?: string }) => {
      runA2ATrustRemove(agentId, withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );

  addWorkspaceOptions(
    a2aCommand
      .command("publish <kind>")
      .description("Queue a canonical A2A envelope for a trusted peer")
      .requiredOption("--peer <agentId>", "Trusted peer agent id")
      .option("--run-id <runId>", "Run id for canonical run artifacts")
      .option("--step-id <stepId>", "Step id for StepAttempt/GateResult/ReviewVerdict")
      .option("--attempt-id <attemptId>", "Attempt id for StepAttempt/GateResult/ReviewVerdict")
      .option("--gate-id <gateId>", "Gate id when publishing a GateResult")
      .option("--artifact-ref <ref>", "Run artifact ref when publishing an Artifact")
      .option("--artifact-type <type>", "Artifact type override")
      .option("--correlation-id <id>", "A2A correlation id override")
      .option("--idempotency-key <key>", "A2A idempotency key override"),
  ).action(
    (
      kind: string,
      opts: {
        peer: string;
        runId?: string;
        stepId?: string;
        attemptId?: string;
        gateId?: string;
        artifactRef?: string;
        artifactType?: never;
        correlationId?: string;
        idempotencyKey?: string;
        workspace?: string;
        repo?: string;
      },
    ) => {
      runA2APublish(kind, withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );

  addWorkspaceOptions(
    a2aCommand.command("sync").description("Deliver queued envelopes and import incoming filesystem envelopes"),
  ).action((opts: { workspace?: string; repo?: string }) => {
    runA2ASync(withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  addWorkspaceOptions(a2aCommand.command("inbox").description("List accepted or quarantined A2A inbox items")).action(
    (opts: { workspace?: string; repo?: string }) => {
      runA2AInbox(withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );

  addWorkspaceOptions(
    a2aCommand.command("accept <messageId>").description("Materialize an incoming A2A initiative as a local run"),
  ).action((messageId: string, opts: { workspace?: string; repo?: string }) => {
    runA2AAccept(messageId, withWorkspaceOptions(opts)).catch(handleCommandError);
  });

  addWorkspaceOptions(
    a2aCommand
      .command("receive <envelope>")
      .description("Validate and optionally accept an A2A envelope into the local loopback inbox")
      .option("--loopback", "Enable local loopback receive mode")
      .option("--local-agent <id>", "Local A2A agent identity", "kiwi-local")
      .option("--trusted-agent <ids>", "Comma-separated trusted sender agent ids"),
  ).action(
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
      runA2AReceive(envelope, withWorkspaceOptions(opts)).catch(handleCommandError);
    },
  );
}
