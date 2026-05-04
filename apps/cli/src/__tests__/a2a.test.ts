import { existsSync, mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { listA2AInbox, loadA2AConfig } from "@ai-kiwi/core";
import {
  runA2AAccept,
  runA2AEnable,
  runA2AInbox,
  runA2APublish,
  runA2ASync,
  runA2ATrustAdd,
  runA2ATrustList,
} from "../commands/a2a";
import { runInit } from "../commands/init";
import { runPlan } from "../commands/plan";

function incoming(cwd: string): string {
  return path.join(cwd, ".kiwi", "a2a", "transport", "incoming");
}

describe("kiwi a2a", () => {
  it("configures trust, syncs an initiative handoff, and accepts it as a local run", async () => {
    const a = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-a2a-a-"));
    const b = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-a2a-b-"));
    await runInit({}, a);
    await runInit({}, b);
    await runA2AEnable({ localAgent: "agent-a" }, a);
    await runA2AEnable({ localAgent: "agent-b" }, b);
    await runA2ATrustAdd("agent-b", { inboxPath: incoming(b) }, a);
    await runA2ATrustAdd("agent-a", { inboxPath: incoming(a) }, b);

    expect(loadA2AConfig(a).peers[0]?.agentId).toBe("agent-b");

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runA2ATrustList({}, a);
    const trustOutput = spy.mock.calls.flat().join("\n");
    spy.mockClear();
    expect(trustOutput).toContain("agent-b");

    await runPlan(
      "# A2A Handoff\n\n## Implement",
      {
        now: new Date("2026-05-04T13:00:00.000Z"),
        runIdSuffix: "a2a1",
        initiativeIdSuffix: "a2a1",
        planIdSuffix: "a2a1",
      },
      a,
    );
    await runA2APublish("initiative", { peer: "agent-b", runId: "run_20260504_130000_a2a1" }, a);
    await runA2ASync({}, a);
    expect(existsSync(incoming(b))).toBe(true);

    await runA2ASync({}, b);
    await runA2AInbox({}, b);
    const inboxOutput = spy.mock.calls.flat().join("\n");
    spy.mockRestore();
    expect(inboxOutput).toContain("initiative");
    expect(inboxOutput).toContain("pending");

    const item = listA2AInbox({ cwd: b })[0];
    expect(item?.messageId).toMatch(/^msg_/);
    await runA2AAccept(item!.messageId, {}, b);
    expect(listA2AInbox({ cwd: b })[0]?.status).toBe("materialized");
  });
});
