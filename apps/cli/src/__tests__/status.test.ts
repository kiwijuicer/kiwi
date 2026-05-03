import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { runStatus } from "../commands/status";

describe("kiwi status", () => {
  it("prints summary even when no runs exist", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-status-"));
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runStatus(cwd);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
