import { describe, expect, it } from "vitest";
import { generateInitiativeId, generatePlanId, generateRunId } from "../ids";

describe("id generation", () => {
  it("uses Europe/Berlin local time for planned run ids in summer time", () => {
    const now = new Date("2026-05-04T12:00:00.000Z");

    expect(generateRunId(now, { suffix: "test" })).toBe("run_20260504_140000_test");
    expect(generateInitiativeId(now, { suffix: "test" })).toBe("init_20260504_140000_test");
    expect(generatePlanId(now, { suffix: "test" })).toBe("plan_20260504_140000_test");
  });

  it("uses Europe/Berlin local time for planned run ids in winter time", () => {
    const now = new Date("2026-01-04T12:00:00.000Z");

    expect(generateRunId(now, { suffix: "test" })).toBe("run_20260104_130000_test");
  });

  it("rolls planned run id dates over in Europe/Berlin local time", () => {
    const now = new Date("2026-05-04T22:30:00.000Z");

    expect(generateRunId(now, { suffix: "test" })).toBe("run_20260505_003000_test");
  });
});
