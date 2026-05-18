import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { runInit } from "../../commands/setup/init";
import { runTail } from "../../commands/runs/tail";

describe("kiwi tail", () => {
  it("prints filtered audit events without following in tests", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-tail-"));
    await runInit({}, cwd);
    mkdirSync(path.join(cwd, ".kiwi", "logs"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".kiwi", "logs", "audit.log"),
      [
        JSON.stringify({
          eventType: "planner_succeeded",
          runId: "run_demo",
          timestamp: "2026-05-08T10:00:00.000Z",
          payload: { phase: "planner" },
        }),
        JSON.stringify({
          eventType: "step_attempt_started",
          runId: "run_other",
          timestamp: "2026-05-08T10:01:00.000Z",
          payload: { stepId: "step_001" },
        }),
      ].join("\n") + "\n",
      "utf-8",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runTail("run_demo", { phase: "planner", noColor: true, follow: false }, cwd);

    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("planner_succeeded");
    expect(output).not.toContain("run_other");
    spy.mockRestore();
  });
});
