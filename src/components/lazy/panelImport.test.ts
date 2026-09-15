import { describe, expect, it, vi } from "vitest";
import { createPanelImport } from "./panelImport";
import { PanelRecoveryRequired } from "./panelFailure";

const panel = { default: () => null };

describe("optional panel imports", () => {
  it("waits until requested and shares pending and successful imports", async () => {
    const load = vi.fn(async () => panel);
    const request = createPanelImport(load);
    expect(load).not.toHaveBeenCalled();
    const first = request();
    expect(request()).toBe(first);
    await expect(first).resolves.toBe(panel);
    await expect(request()).resolves.toBe(panel);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures and can recover without reloading the app", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(panel);
    const request = createPanelImport(load);
    await expect(request()).rejects.toThrow("offline");
    await expect(request()).resolves.toBe(panel);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("turns synchronous loader errors into retryable failures", async () => {
    const load = vi.fn().mockImplementationOnce(() => { throw new Error("load failed"); }).mockResolvedValue(panel);
    const request = createPanelImport(load);
    await expect(request()).rejects.toThrow("load failed");
    await expect(request()).resolves.toBe(panel);
  });

  it("keeps an opaque module-cache failure unavailable across later opens", async () => {
    const error = new TypeError("Importing a module script failed.");
    const load = vi.fn().mockRejectedValue(error);
    const request = createPanelImport(load, "SettingsPanel");
    await expect(request()).rejects.toBe(error);
    await expect(request()).rejects.toBeInstanceOf(PanelRecoveryRequired);
    await expect(request()).rejects.toBeInstanceOf(PanelRecoveryRequired);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
