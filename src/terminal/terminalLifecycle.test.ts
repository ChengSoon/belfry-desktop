import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { createTerminal, detachTerminal, writeTerminal } from "./api";
import { mountTerminal, type MountCallbacks, type TerminalHandle } from "./terminalController";
import type { TerminalEvent, TerminalLaunch, TerminalSession } from "./contracts";

vi.mock("@tauri-apps/api/core", () => ({ Channel: class { onmessage = (_: unknown) => {}; } }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock("./api", () => ({ createTerminal: vi.fn(), detachTerminal: vi.fn(), writeTerminal: vi.fn(), resizeTerminal: vi.fn(), setTerminalPalette: vi.fn() }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class { onContextLoss() {} dispose() {} } }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80; rows = 24; options: Record<string, unknown>;
  constructor(options: Record<string, unknown>) { this.options = options; }
  loadAddon() {} open() {} attachCustomKeyEventHandler() {} focus() {} dispose() {}
  onData() { return { dispose() {} }; }
  write() {} reset() {} clearTextureAtlas() {} refresh() {}
} }));
vi.mock("./unicode", () => ({ configureUnicode() {} }));
vi.mock("./links", () => ({ registerHttpLinkProvider: () => ({ dispose() {} }), registerFileLinkProvider: () => ({ dispose() {} }) }));
vi.mock("./fontRendering", () => ({ loadTerminalFonts: async () => {}, terminalFontWeights: () => ({ fontWeight: 400, fontWeightBold: 600 }) }));
vi.mock("./clipboardPaste", () => ({ usesWebClipboardFallback: () => true, consumeWebClipboardPaste() {}, listenForClipboardImagePaste() {} }));
vi.mock("./promptUserInput", () => ({ listenForPromptUserInput: () => () => {} }));

const handles: TerminalHandle[] = [];
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.mocked(detachTerminal).mockResolvedValue(undefined);
  vi.mocked(writeTerminal).mockResolvedValue(undefined);
});
afterEach(() => {
  handles.splice(0).forEach((handle) => handle.dispose());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

function fixture() {
  let resolve!: (session: TerminalSession) => void;
  let channel!: Channel<TerminalEvent>;
  const pending = new Promise<TerminalSession>((done) => { resolve = done; });
  vi.mocked(createTerminal).mockImplementation((_request, events) => { channel = events; return pending; });
  const callbacks: MountCallbacks = { onPhase: vi.fn(), onError: vi.fn(), onSession: vi.fn(),
    onInput: vi.fn(), onActivity: vi.fn(), onAgentState: vi.fn(), onOpenFile: vi.fn(), onSearchRequest: vi.fn() };
  const launch: TerminalLaunch = { profileId: "shell:bash", tabId: "lifecycle-tab", cwd: "file:///tmp",
    collaborationMode: false, resumeSessionId: null, ssh: null,
    projectLaunch: { env: {}, startup: { command: "printf qa-startup" } } };
  const session: TerminalSession = { id: "qa-pty", platform: "macos", shell: "bash", cwd: "file:///tmp",
    cols: 80, rows: 24, status: "running", exitCode: null, reconnected: false, connectionId: "qa-connection" };
  const host = { clientWidth: 0, classList: { remove() {} } } as unknown as HTMLDivElement;
  const handle = mountTerminal(host, launch, { foreground: "#ffffff", background: "#000000" }, false,
    { fontFamily: "", fontSize: 14 }, callbacks);
  handles.push(handle);
  return { callbacks, handle, session, emit: (event: TerminalEvent) => channel.onmessage(event),
    ready: async (patch: Partial<TerminalSession> = {}) => { resolve({ ...session, ...patch }); await vi.runAllTimersAsync(); } };
}

describe("terminal attachment lifecycle", () => {
  it("does not steal the selected pane's focus when attachments become ready", async () => {
    const focus = vi.spyOn(Terminal.prototype, "focus");
    const selected = fixture();
    const background = fixture();
    selected.handle.focus();
    await selected.ready({ reconnected: true });
    await background.ready({ reconnected: true });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it.each([
    { kind: "disconnected", sessionId: "qa-pty", message: "后台连接已中断" } as const,
    { kind: "output", sessionId: "qa-pty", sequence: 99, bytes: [120], eof: false } as const,
  ])("does not turn an early $kind failure back into running when create resolves", async (event) => {
    const test = fixture();
    test.emit({ ...event, ...(event.kind === "output" ? { bytes: [...event.bytes] } : {}) } as TerminalEvent);
    await test.ready();
    expect(test.callbacks.onPhase).toHaveBeenLastCalledWith("error");
    expect(test.callbacks.onSession).toHaveBeenLastCalledWith(test.session);
    expect(writeTerminal).not.toHaveBeenCalled();
    expect(test.handle.sendText("must not send")).toBe(false);
  });

  it("keeps the exited identity without resurrecting an early process exit", async () => {
    const test = fixture();
    test.emit({ kind: "exit", sessionId: test.session.id, exitCode: 0, reason: "normal" });
    await test.ready();
    expect(test.callbacks.onPhase).toHaveBeenLastCalledWith("exited");
    expect(test.callbacks.onSession).toHaveBeenLastCalledWith(test.session);
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("detaches a late create after disposal without running the project startup command", async () => {
    const test = fixture();
    test.handle.dispose();
    await test.ready();
    expect(detachTerminal).toHaveBeenCalledWith(test.session);
    expect(test.callbacks.onSession).toHaveBeenCalledTimes(1);
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it.each([false, true])("runs the startup command only for a new process (reconnected: %s)", async (reconnected) => {
    const test = fixture();
    await test.ready({ reconnected });
    expect(test.callbacks.onPhase).toHaveBeenLastCalledWith("running");
    expect(writeTerminal).toHaveBeenCalledTimes(reconnected ? 0 : 1);
    if (!reconnected) expect(writeTerminal).toHaveBeenCalledWith(test.session.id, new TextEncoder().encode("printf qa-startup\r"));
  });
});
