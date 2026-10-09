import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { acknowledgeTerminalOutput, createTerminal, detachTerminal, writeTerminal } from "./api";
import { mountTerminal, type MountCallbacks, type TerminalHandle } from "./terminalController";
import type { TerminalEvent, TerminalLaunch, TerminalSession } from "./contracts";

vi.mock("@tauri-apps/api/core", () => ({ Channel: class { onmessage = (_: unknown) => {}; } }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock("./api", () => ({ acknowledgeTerminalOutput: vi.fn(), createTerminal: vi.fn(), detachTerminal: vi.fn(), writeTerminal: vi.fn(), resizeTerminal: vi.fn(), setTerminalPalette: vi.fn() }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class { onContextLoss() {} dispose() {} } }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80; rows = 24; options: Record<string, unknown>;
  private data: ((text: string) => void) | undefined;
  constructor(options: Record<string, unknown>) { this.options = options; }
  loadAddon() {} open() {} attachCustomKeyEventHandler() {} focus() {} dispose() {}
  onData(callback: (text: string) => void) { this.data = callback; return { dispose() {} }; }
  onWriteParsed() { return { dispose() {} }; }
  paste(text: string) { this.data?.(`\x1b[200~${text.replace(/\r?\n/gu, "\r")}\x1b[201~`); }
  input(text: string) { this.data?.(text); }
  write(_data: unknown, parsed?: () => void) { parsed?.(); } reset() {} clearTextureAtlas() {} refresh() {}
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
  vi.stubGlobal("navigator", { userAgent: "Mac" });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.mocked(detachTerminal).mockResolvedValue(undefined);
  vi.mocked(writeTerminal).mockResolvedValue(undefined);
  vi.mocked(acknowledgeTerminalOutput).mockResolvedValue(true);
});
afterEach(() => {
  handles.splice(0).forEach((handle) => handle.dispose());
  vi.restoreAllMocks();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

function fixture(launchPatch: Partial<TerminalLaunch> = {}, initialFailure?: unknown) {
  let resolve!: (session: TerminalSession) => void;
  let channel!: Channel<TerminalEvent>;
  const pending = new Promise<TerminalSession>((done) => { resolve = done; });
  vi.mocked(createTerminal).mockImplementation((_request, events) => { channel = events; return pending; });
  if (initialFailure !== undefined) vi.mocked(createTerminal).mockRejectedValueOnce(initialFailure);
  const callbacks: MountCallbacks = { onPhase: vi.fn(), onError: vi.fn(), onSession: vi.fn(), onAttachmentLost: vi.fn(),
    onInput: vi.fn(), onActivity: vi.fn(), onAgentState: vi.fn(), onOpenFile: vi.fn(), onSearchRequest: vi.fn() };
  const launch: TerminalLaunch = { profileId: "shell:bash", tabId: "lifecycle-tab", cwd: "file:///tmp",
    collaborationMode: false, resumeSessionId: null, ssh: null,
    projectLaunch: { env: {}, startup: { command: "printf qa-startup" } }, ...launchPatch };
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
  it("restores a missing saved Agent automatically once, retaining native history and not rerunning startup", async () => {
    const test = fixture({ attachmentId: "old-pty", profileId: "agent:codex", resumeSessionId: "native-history" },
      { code: "SESSION_MISSING", message: "原后台任务已不存在。" });
    await vi.advanceTimersByTimeAsync(0);
    expect(createTerminal).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createTerminal).mock.calls[1][0].resume).toBe("native-history");
    expect(vi.mocked(createTerminal).mock.calls[1][2]).toBeNull();
    expect(test.callbacks.onAttachmentLost).toHaveBeenCalledOnce();
    await test.ready();
    expect(test.callbacks.onPhase).toHaveBeenLastCalledWith("running");
    expect(test.callbacks.onError).toHaveBeenLastCalledWith(expect.stringContaining("历史对话"));
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("recovers a missing Shell once without replaying commands", async () => {
    const test = fixture({ attachmentId: "old-pty" },
      { code: "IO_ERROR", message: "原后台任务已不存在。请点击「重启」明确启动新进程" });
    await vi.advanceTimersByTimeAsync(0);
    await test.ready();
    expect(createTerminal).toHaveBeenCalledTimes(2);
    expect(test.callbacks.onError).toHaveBeenLastCalledWith(expect.stringContaining("重新建立会话"));
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it.each(["IO_ERROR", "PERMISSION_DENIED", "INVALID_ARGUMENT"])("does not spawn a new process on %s", async (code) => {
    const test = fixture({ attachmentId: "old-pty" }, { code, message: "connection unavailable" });
    await vi.runAllTimersAsync();
    expect(createTerminal).toHaveBeenCalledOnce();
    expect(test.callbacks.onAttachmentLost).not.toHaveBeenCalled();
    expect(test.callbacks.onPhase).toHaveBeenLastCalledWith("error");
  });

  it("does not loop when the single automatic recovery also fails", async () => {
    const error = { code: "SESSION_MISSING", message: "原后台任务已不存在。" };
    const test = fixture({ attachmentId: "old-pty" }, error);
    vi.mocked(createTerminal).mockRejectedValueOnce(error);
    await vi.runAllTimersAsync();
    expect(createTerminal).toHaveBeenCalledTimes(2);
    expect(test.callbacks.onPhase).toHaveBeenLastCalledWith("error");
    expect(test.callbacks.onAttachmentLost).toHaveBeenCalledOnce();
  });

  it("does not recover a missing attachment after unmount", async () => {
    const test = fixture({ attachmentId: "old-pty" }, { code: "SESSION_MISSING" });
    test.handle.dispose();
    await vi.runAllTimersAsync();
    expect(createTerminal).toHaveBeenCalledOnce();
    expect(test.callbacks.onAttachmentLost).not.toHaveBeenCalled();
  });

  it("detaches an early batch immediately when disposed before create resolves", async () => {
    vi.spyOn(Terminal.prototype, "write").mockImplementation(() => {});
    const test = fixture();
    test.emit({ kind: "output_batch", sessionId: test.session.id, connectionId: test.session.connectionId!, deliveryId: 1,
      events: [{ kind: "output", sessionId: test.session.id, sequence: 0, bytes: [120], eof: false }] });
    test.handle.dispose();
    expect(detachTerminal).toHaveBeenCalledWith({ id: test.session.id, connectionId: test.session.connectionId });
    expect(acknowledgeTerminalOutput).not.toHaveBeenCalled();
    await test.ready();
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("acknowledges early output with its own connection only after xterm consumes it", async () => {
    let parsed!: () => void;
    vi.spyOn(Terminal.prototype, "write").mockImplementation((_data, done) => { parsed = done!; });
    const test = fixture();
    test.emit({ kind: "output_batch", sessionId: test.session.id, connectionId: test.session.connectionId!, deliveryId: 1,
      events: [{ kind: "output", sessionId: test.session.id, sequence: 0, bytes: [120], eof: false }] });
    await test.ready({ reconnected: true });
    expect(acknowledgeTerminalOutput).not.toHaveBeenCalled();
    parsed();
    await vi.runAllTimersAsync();
    expect(acknowledgeTerminalOutput).toHaveBeenCalledWith({ sessionId: test.session.id,
      connectionId: test.session.connectionId, deliveryId: 1 });
  });

  it("keeps prompt input responsive while output awaits the parser", async () => {
    vi.spyOn(Terminal.prototype, "write").mockImplementation(() => {});
    const test = fixture();
    await test.ready({ reconnected: true });
    test.emit({ kind: "output_batch", sessionId: test.session.id, connectionId: test.session.connectionId!, deliveryId: 1,
      events: [{ kind: "output", sessionId: test.session.id, sequence: 0, bytes: [120], eof: false }] });
    expect(test.handle.sendText("still responsive")).toBe(true);
    await vi.runAllTimersAsync();
    expect(writeTerminal).toHaveBeenCalledTimes(2);
    expect(acknowledgeTerminalOutput).not.toHaveBeenCalled();
  });

  it("detach cancels an outstanding parse and suppresses its late acknowledgement", async () => {
    let parsed!: () => void;
    vi.spyOn(Terminal.prototype, "write").mockImplementation((_data, done) => { parsed = done!; });
    const test = fixture();
    await test.ready({ reconnected: true });
    test.emit({ kind: "output_batch", sessionId: test.session.id, connectionId: test.session.connectionId!, deliveryId: 1,
      events: [{ kind: "output", sessionId: test.session.id, sequence: 0, bytes: [120], eof: false }] });
    test.handle.dispose();
    parsed();
    await vi.runAllTimersAsync();
    expect(acknowledgeTerminalOutput).not.toHaveBeenCalled();
    expect(detachTerminal).toHaveBeenCalledWith({ ...test.session, reconnected: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an acknowledgement error detaches without restarting the agent", async () => {
    vi.mocked(acknowledgeTerminalOutput).mockRejectedValue(new Error("bridge closed"));
    const test = fixture();
    await test.ready({ reconnected: true });
    test.emit({ kind: "output_batch", sessionId: test.session.id, connectionId: test.session.connectionId!, deliveryId: 1,
      events: [{ kind: "output", sessionId: test.session.id, sequence: 0, bytes: [120], eof: false }] });
    await vi.runAllTimersAsync();
    expect(test.callbacks.onPhase).toHaveBeenLastCalledWith("error");
    expect(detachTerminal).toHaveBeenCalledWith({ ...test.session, reconnected: true });
    expect(createTerminal).toHaveBeenCalledOnce();
    expect(writeTerminal).not.toHaveBeenCalled();
    expect(test.handle.sendText("late")).toBe(false);
  });

  it("does not steal the selected pane's focus when attachments become ready", async () => {
    const focus = vi.spyOn(Terminal.prototype, "focus");
    const selected = fixture();
    const background = fixture();
    selected.handle.focus();
    await selected.ready({ reconnected: true });
    await background.ready({ reconnected: true });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("Windows background submission preserves focus and reports completion after the Enter write", async () => {
    vi.stubGlobal("navigator", { userAgent: "Windows NT 10.0" });
    const focus = vi.spyOn(Terminal.prototype, "focus");
    const test = fixture();
    await test.ready({ platform: "windows", reconnected: true });
    const onResult = vi.fn();
    expect(test.handle.sendText("one\ntwo", { background: true, onResult })).toBe(true);
    await vi.advanceTimersByTimeAsync(599);
    expect(writeTerminal).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(writeTerminal).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledExactlyOnceWith("submitted");
    expect(focus).not.toHaveBeenCalled();
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
