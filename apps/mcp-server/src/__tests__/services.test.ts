import { afterEach, describe, expect, it, vi } from "vitest";

describe("MCP services", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@kiwi/core");
    vi.doUnmock("@kiwi/runtime");
  });

  it("does not construct core/runtime services at import time", async () => {
    const coreServices = { marker: "core" };
    const runtimeServices = { marker: "runtime" };
    const createCoreServices = vi.fn(() => coreServices);
    const createRuntimeServices = vi.fn(() => runtimeServices);

    vi.doMock("@kiwi/core", () => ({ createCoreServices }));
    vi.doMock("@kiwi/runtime", () => ({ createRuntimeServices }));

    const module = await import("../services.js");

    expect(createCoreServices).not.toHaveBeenCalled();
    expect(createRuntimeServices).not.toHaveBeenCalled();

    const services = module.getMcpServerServices();

    expect(services).toBe(module.getMcpServerServices());
    expect(createCoreServices).toHaveBeenCalledTimes(1);
    expect(createRuntimeServices).toHaveBeenCalledTimes(1);
    expect(createRuntimeServices).toHaveBeenCalledWith({
      core: coreServices,
      env: expect.objectContaining({ KIWI_EXECUTION_ISOLATION: "direct" }),
    });
  });
});
