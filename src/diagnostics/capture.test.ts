import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { captureException, diagnosticError, exportDiagnostics, installGlobalErrorCapture } from "./capture";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());

it("extracts only error fields without serializing rejected objects or throwing getters", () => {
  const cause = { message: "request failed", config: { apiKey: "never-log-me" }, userInput: "private text", stack: "trace" };
  const entry = diagnosticError(cause, "window.unhandledrejection");
  expect(entry).toEqual({ level: "error", source: "window.unhandledrejection", message: "request failed", stack: "trace" });
  expect(JSON.stringify(entry)).not.toContain("never-log-me");
  const bad = Object.defineProperty({}, "message", { get() { throw new Error("do not execute me"); } });
  expect(diagnosticError(bad, "window.error").message).toBe("Unexpected application error");
});

it("bounds Unicode error fields in bytes to satisfy the backend logging contract", async () => {
  await captureException({ message: "错".repeat(10_000), stack: "堆".repeat(40_000) }, "源".repeat(300));
  const { entry } = vi.mocked(invoke).mock.calls[0][1] as { entry: { message: string; stack: string; source: string } };
  expect(new TextEncoder().encode(entry.message).length).toBeLessThanOrEqual(8192);
  expect(new TextEncoder().encode(entry.stack).length).toBeLessThanOrEqual(32768);
  expect(new TextEncoder().encode(entry.source).length).toBeLessThanOrEqual(256);
  expect(entry.message).not.toContain("\uFFFD");
});

it("does not call the logger recursively or reject when the logging transport fails", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("logger unavailable"));
  expect(await captureException(new Error("original failure"), "window.error")).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("finishes pending crash writes before exporting the backend-sanitized diagnostic summary", async () => {
  let finish!: () => void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  vi.mocked(invoke).mockResolvedValueOnce({ summary: "safe", createdAt: 10, path: "/diagnostic", sizeBytes: 4 });
  void captureException(new Error("crash"), "react.boundary", "component stack");
  const result = exportDiagnostics();
  await Promise.resolve();
  expect(invoke).toHaveBeenCalledTimes(1);
  finish();
  expect((await result).summary).toBe("safe");
  expect(invoke).toHaveBeenLastCalledWith("diagnostics_export");
});

it("captures and unregisters both global handlers, omitting file query parameters", async () => {
  const handlers = new Map<string, (event: unknown) => void>();
  const target = { addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    removeEventListener: (name: string) => handlers.delete(name) } as unknown as Window;
  const stop = installGlobalErrorCapture(target);
  handlers.get("error")!({ message: "script failure", filename: "https://app.invalid/a.js?token=secret", lineno: 2, colno: 3 });
  handlers.get("unhandledrejection")!({ reason: { message: "async failure", payload: "private" } });
  await Promise.resolve(); await Promise.resolve();
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenCalledWith("app_log_write", { entry: { level: "error", source: "window.error", message: "script failure",
    context: { file: "https://app.invalid/a.js", line: "2", column: "3" } } });
  stop();
  expect(handlers.size).toBe(0);
});
