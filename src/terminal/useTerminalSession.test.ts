import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { AgentKind } from "../agent/contracts";
import type { HookSnapshot } from "../agent/hooks/contracts";
import { acknowledgeTerminalOutput, closeTerminal, closeTerminalTab, createTerminal, detachTerminal, writeTerminal } from "./api";
import type { TerminalEvent, TerminalLaunch, TerminalSession } from "./contracts";
import * as controller from "./terminalController";
import { useTerminalSession } from "./useTerminalSession";

// 仓库的 Node hook 宿主：保留 state/ref、比较 effect 依赖并执行 cleanup。
// useTerminalSession、mountTerminal、Lifecycle 和请求构造全部运行生产代码；只替换 React 调度与设备边界。
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], pending: [] as Array<() => void>, dirty: false }));
vi.mock("react", async (original) => {
  const memo = <T,>(make: () => T, deps: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as { deps: unknown[]; value: T } | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) hooks.slots[index] = { deps, value: make() };
    return (hooks.slots[index] as { value: T }).value;
  };
  return { ...await original<typeof import("react")>(),
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    useState: <T,>(initial: T) => {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
      return [hooks.slots[index], (next: T | ((value: T) => T)) => {
        const value = typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
        if (!Object.is(value, hooks.slots[index])) hooks.dirty = true;
        hooks.slots[index] = value;
      }];
    },
    useRef: <T,>(initial: T) => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: <T,>(callback: T, deps: unknown[]) => memo(() => callback, deps),
    useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        const slot = { deps, cleanup: previous?.cleanup, effect: true };
        hooks.slots[index] = slot;
        hooks.pending.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
});
const appearance = vi.hoisted(() => ({ mode: "light", runtime: { fontFamily: "", fontSize: 14 } }));
vi.mock("../theme/ThemeProvider", () => ({ useTheme: () => appearance }));
vi.mock("../typography/TypographyProvider", () => ({ useTypography: () => appearance }));
vi.mock("../background/BackgroundProvider", () => ({ useBackground: () => ({ url: null }) }));
vi.mock("@tauri-apps/api/core", () => ({ Channel: class { onmessage = (_: unknown) => {}; } }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock("./api", () => ({ createTerminal: vi.fn(), closeTerminal: vi.fn(), closeTerminalTab: vi.fn(), detachTerminal: vi.fn(),
  writeTerminal: vi.fn(), acknowledgeTerminalOutput: vi.fn(), resizeTerminal: vi.fn(), setTerminalPalette: vi.fn() }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class { onContextLoss() {} dispose() {} } }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80; rows = 24; options: Record<string, unknown>;
  private data: ((text: string) => void) | undefined;
  constructor(options: Record<string, unknown>) { this.options = options; }
  loadAddon() {} open() {} attachCustomKeyEventHandler() {} focus() {} dispose() {}
  onData(callback: (text: string) => void) { this.data = callback; return { dispose() {} }; }
  onWriteParsed() { return { dispose() {} }; }
  paste(text: string) { this.data?.(`\x1b[200~${text}\x1b[201~`); }
  input(text: string) { this.data?.(text); }
  write(_data: unknown, parsed?: () => void) { parsed?.(); } reset() {} clearTextureAtlas() {} refresh() {}
} }));
vi.mock("./unicode", () => ({ configureUnicode() {} }));
vi.mock("./links", () => ({ registerHttpLinkProvider: () => ({ dispose() {} }), registerFileLinkProvider: () => ({ dispose() {} }) }));
vi.mock("./fontRendering", () => ({ loadTerminalFonts: async () => {}, terminalFontWeights: () => ({ fontWeight: 400, fontWeightBold: 600 }) }));
vi.mock("./clipboardPaste", () => ({ usesWebClipboardFallback: () => true, consumeWebClipboardPaste() {}, listenForClipboardImagePaste() {} }));
vi.mock("./promptUserInput", () => ({ listenForPromptUserInput: () => () => {} }));

let launch: TerminalLaunch;
let container: { current: HTMLDivElement };
let view: ReturnType<typeof useTerminalSession>;
let mounted = false;
let mounts: MockInstance<typeof controller.mountTerminal>;
const missing = { code: "SESSION_MISSING", message: "原后台任务已不存在。", retryable: false };
const network = { code: "IO_ERROR", message: "后台连接失败：connection reset", retryable: true };

function session(id: string, reconnected = false): TerminalSession {
  return { id, reconnected, connectionId: `connection-${vi.mocked(createTerminal).mock.calls.length}`, platform: "macos",
    shell: "codex", cwd: "file:///project", cols: 80, rows: 24, status: "running", exitCode: null };
}
function snapshot(id: string, sequence = 1, agent: AgentKind = "codex"): HookSnapshot {
  return { agent, session: { agent, id }, sequence, source: "hook", state: "processing", occurredAt: sequence,
    reason: "处理中", transcriptPath: null };
}
function render() {
  if (!mounted) return;
  let turns = 0;
  do {
    if (++turns > 20) throw new Error("hook render did not settle");
    hooks.cursor = 0; hooks.dirty = false;
    view = useTerminalSession(container, launch);
    hooks.pending.splice(0).forEach((effect) => effect());
  } while (hooks.dirty);
}
async function flush() {
  for (let turn = 0; turn < 20; turn++) {
    render();
    await vi.advanceTimersByTimeAsync(0);
    if (!hooks.dirty || !mounted) return;
  }
  throw new Error("async hook render did not settle");
}
async function start(patch: Partial<TerminalLaunch> = {}) { launch = { ...launch, ...patch }; mounted = true; await flush(); }
async function advance(ms: number) { await vi.advanceTimersByTimeAsync(ms); await flush(); }
function unmount() {
  if (!mounted) return;
  mounted = false;
  for (const slot of hooks.slots as Array<{ effect?: boolean; cleanup?: () => void } | undefined>) {
    if (slot?.effect) slot.cleanup?.();
  }
}
function request(index = -1) { return vi.mocked(createTerminal).mock.calls.at(index)!; }
async function emit(event: TerminalEvent) { request()[1].onmessage(event); await flush(); }
async function disconnect() {
  await emit({ kind: "disconnected", sessionId: view.daemonSessionId!, message: "后台连接失败：connection reset" });
}
async function hook(id: string, sequence = 1) {
  await emit({ kind: "agent_state", sessionId: view.daemonSessionId!, snapshot: snapshot(id, sequence) });
}

beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.pending = []; hooks.dirty = false; mounted = false;
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { userAgent: "Mac" });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  appearance.mode = "light";
  container = { current: { clientWidth: 0, clientHeight: 0, classList: { remove() {} } } as unknown as HTMLDivElement };
  launch = { profileId: "agent:codex", cwd: "file:///project", tabId: "tab", collaborationMode: false,
    resumeSessionId: null, ssh: null, projectLaunch: { env: {}, startup: { command: "startup-once" } } };
  vi.mocked(createTerminal).mockImplementation(async (_request, _channel, attachment) => session(attachment ?? `pty-${vi.mocked(createTerminal).mock.calls.length}`, !!attachment));
  vi.mocked(closeTerminal).mockResolvedValue(undefined);
  vi.mocked(closeTerminalTab).mockResolvedValue(undefined);
  vi.mocked(detachTerminal).mockResolvedValue(undefined);
  vi.mocked(writeTerminal).mockResolvedValue(undefined);
  vi.mocked(acknowledgeTerminalOutput).mockResolvedValue(true);
  mounts = vi.spyOn(controller, "mountTerminal");
});
afterEach(() => { unmount(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("native identity during restart and recovery", () => {
  it("accepts a batched native identity without fabricating Hook state, and preserves it on restart", async () => {
    await start();
    const originalPty = view.daemonSessionId!;
    await emit({ kind: "output_batch", sessionId: originalPty, connectionId: "connection-1", deliveryId: 1,
      events: [{ kind: "session_identity", sessionId: originalPty, session: { agent: "codex", id: "native-only" } }] });
    expect(view.agentSessionRef).toEqual({ agent: "codex", id: "native-only" });
    expect(view.agentState).toBeNull();
    expect(view.phase).toBe("running");
    expect(acknowledgeTerminalOutput).toHaveBeenCalledWith({ sessionId: originalPty, connectionId: "connection-1", deliveryId: 1 });
    expect(mounts).toHaveBeenCalledTimes(1);
    view.restart(); await flush();
    expect(request()[0].resume).toBe("native-only");
    expect(view.agentSessionRef?.id).toBe("native-only");
    expect(view.agentState).toBeNull();
  });

  it("captures history from an exited replay even though activity updates have stopped", async () => {
    await start({ attachmentId: "saved-pty" });
    await emit({ kind: "output_batch", sessionId: "saved-pty", connectionId: "connection-1", deliveryId: 1,
      events: [
        { kind: "agent_state", sessionId: "saved-pty", snapshot: snapshot("exited-history") },
        { kind: "exit", sessionId: "saved-pty", exitCode: 0, reason: "normal" },
      ] });
    expect(view.phase).toBe("exited");
    expect(view.agentSessionRef?.id).toBe("exited-history");
    expect(view.agentState).toBeNull();
    view.restart(); await flush();
    expect(request()[0].resume).toBe("exited-history");
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("updates the workspace identity without remounting, then restarts with that identity", async () => {
    await start();
    launch = { ...launch, agentSessionRef: { agent: "codex", id: "latest" } };
    await flush();
    expect(mounts).toHaveBeenCalledTimes(1);
    expect(launch.resumeSessionId).toBeNull();
    expect(request()[3]).toBe(false);
    view.restart(); await flush();
    expect(closeTerminalTab).toHaveBeenCalledExactlyOnceWith("tab");
    expect(request()[0].resume).toBe("latest");
    expect(request()[2]).toBeNull();
    expect(request()[3]).toBe(false);
    expect(writeTerminal).toHaveBeenCalledTimes(1);
    expect(vi.mocked(closeTerminalTab).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(createTerminal).mock.invocationCallOrder[1]);
  });

  it("retains a newer Hook identity through stale props, reconnect failure and a manual restart", async () => {
    await start({ resumeSessionId: "old", agentSessionRef: { agent: "codex", id: "old" } });
    await hook("current");
    expect(mounts).toHaveBeenCalledTimes(1);
    const originalPty = view.daemonSessionId;
    await disconnect();
    vi.mocked(createTerminal).mockRejectedValueOnce(network);
    view.reconnect(); await flush();
    expect(request()[0].resume).toBe("current");
    expect(request()[2]).toBe(originalPty);
    expect(view.agentState).toBeNull();
    view.restart(); await flush();
    expect(request()[0].resume).toBe("current");
    expect(request()[2]).toBeNull();
    await advance(5000);
    expect(createTerminal).toHaveBeenCalledTimes(3);
    expect(writeTerminal).toHaveBeenCalledTimes(1);
  });

  it("does not let a delayed activity snapshot overwrite the newest raw Hook identity", async () => {
    await start(); await hook("old");
    await emit({ kind: "agent_state", sessionId: view.daemonSessionId!, snapshot: { ...snapshot("new", 2), state: "completed" } });
    // 完成状态等待界面稳定，期间 HookActivity 仍展示前一条状态。
    expect(view.agentState?.session?.id).toBe("old");
    expect(view.agentSessionRef?.id).toBe("new");
    view.restart(); await flush();
    expect(request()[0].resume).toBe("new");
  });

  it("reads an identity updated while the saved attachment request is pending", async () => {
    let reject!: (error: unknown) => void;
    vi.mocked(createTerminal).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    await start({ attachmentId: "saved-pty", resumeSessionId: "old" });
    launch = { ...launch, agentSessionRef: { agent: "codex", id: "new" } };
    await flush();
    expect(createTerminal).toHaveBeenCalledTimes(1);
    reject(missing); await flush();
    expect(createTerminal).toHaveBeenCalledTimes(2);
    expect(request()[0].resume).toBe("new");
    expect(request()[2]).toBeNull();
    expect(request()[3]).toBe(false);
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("keeps history when automatic missing recovery fails and the user restarts", async () => {
    vi.mocked(createTerminal).mockRejectedValueOnce(missing).mockRejectedValueOnce(network);
    await start({ attachmentId: "saved-pty", agentSessionRef: { agent: "codex", id: "history" } });
    expect(view.phase).toBe("error");
    expect(view.daemonSessionId).toBeNull();
    await advance(30_000);
    expect(createTerminal).toHaveBeenCalledTimes(2);
    view.restart(); await flush();
    expect(request()[0].resume).toBe("history");
    expect(request()[2]).toBeNull();
    expect(createTerminal).toHaveBeenCalledTimes(3);
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it.each([
    { tabId: "other-tab" }, { profileId: "agent:claude" as const }, { cwd: "file:///other-project" },
  ])("does not borrow captured history or attachment after changing $tabId $profileId $cwd", async (change) => {
    await start(); await hook("old-scope-history");
    const oldCallbacks = mounts.mock.calls[0][5];
    launch = { ...launch, ...change };
    await flush();
    expect(request()[0].resume).toBeNull();
    expect(request()[2]).toBeNull();
    expect(request()[3]).toBe(false);
    oldCallbacks.onAgentState?.(snapshot("late-old-history", 2));
    view.restart(); await flush();
    expect(request()[0].resume).toBeNull();
  });

  it("ignores native identities for a different Agent", async () => {
    await start({ resumeSessionId: "codex-history", agentSessionRef: { agent: "claude", id: "wrong" } });
    await emit({ kind: "session_identity", sessionId: view.daemonSessionId!, session: { agent: "pi", id: "also-wrong" } });
    view.restart(); await flush();
    expect(request()[0].resume).toBe("codex-history");
  });

  it.each([null, "saved-history"])("recovers a saved exited process with resume=%s without claiming unconfirmed history", async (resumeSessionId) => {
    vi.mocked(createTerminal).mockResolvedValueOnce(session("replacement"));
    await start({ attachmentId: "exited-pty", resumeSessionId });
    expect(request()[3]).toBe(true);
    expect(view.daemonSessionId).toBe("replacement");
    expect(view.phase).toBe("running");
    expect(writeTerminal).not.toHaveBeenCalled();
    if (resumeSessionId) expect(view.error).toContain("正在恢复历史对话");
    else expect(view.error).not.toContain("恢复历史");
  });
});

describe("bounded reconnection of the original PTY", () => {
  it("backs off three times on transport failure, then leaves manual reconnect available", async () => {
    await start(); await hook("history");
    const originalPty = view.daemonSessionId;
    vi.mocked(createTerminal).mockRejectedValue(network);
    await disconnect();
    for (const [index, delay] of [500, 1000, 2000].entries()) {
      await advance(delay - 1);
      expect(createTerminal).toHaveBeenCalledTimes(index + 1);
      await advance(1);
      expect(createTerminal).toHaveBeenCalledTimes(index + 2);
      expect(request()[2]).toBe(originalPty);
      expect(request()[3]).toBe(true);
      expect(request()[0].resume).toBe("history");
    }
    await advance(60_000);
    expect(createTerminal).toHaveBeenCalledTimes(4);
    expect(view.phase).toBe("error");
    expect(view.canReconnect).toBe(true);
    vi.mocked(createTerminal).mockResolvedValueOnce(session(originalPty!, true));
    view.reconnect(); await flush();
    expect(createTerminal).toHaveBeenCalledTimes(5);
    expect(view.phase).toBe("running");
    expect(closeTerminalTab).not.toHaveBeenCalled();
    expect(closeTerminal).not.toHaveBeenCalled();
    expect(writeTerminal).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: "PERMISSION_DENIED", message: "permission denied", retryable: true },
    { code: "INVALID_ARGUMENT", message: "后台任务的项目或类型已改变", retryable: true },
    { code: "IO_ERROR", message: "后台连接失败：permission denied", retryable: true },
    { code: "IO_ERROR", message: "connection reset", retryable: false },
  ])("does not retry or recreate a non-retryable attachment failure: $code / $message", async (error) => {
    vi.mocked(createTerminal).mockRejectedValue(error);
    await start({ attachmentId: "saved-pty" });
    await advance(60_000);
    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(request()[2]).toBe("saved-pty");
    expect(view.phase).toBe("error");
    expect(closeTerminalTab).not.toHaveBeenCalled();
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("does not retry an ambiguous initial creation without a known PTY", async () => {
    vi.mocked(createTerminal).mockRejectedValue(network);
    await start(); await advance(60_000);
    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(view.canReconnect).toBe(false);
  });

  it("does not reset the attempt limit on a connection that immediately disconnects again", async () => {
    await start();
    for (const delay of [500, 1000, 2000]) { await disconnect(); await advance(delay); }
    await disconnect(); await advance(60_000);
    expect(createTerminal).toHaveBeenCalledTimes(4);
    expect(view.phase).toBe("error");
  });

  it("starts a new retry budget only after the connection stays healthy", async () => {
    await start(); await disconnect(); await advance(500);
    await advance(10_000);
    await disconnect(); await advance(499);
    expect(createTerminal).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(createTerminal).toHaveBeenCalledTimes(3);
  });

  it("manual reconnect cancels the pending automatic attempt and preserves the PTY", async () => {
    await start(); const originalPty = view.daemonSessionId;
    await disconnect(); view.reconnect(); await flush(); await advance(3000);
    expect(createTerminal).toHaveBeenCalledTimes(2);
    expect(request()[2]).toBe(originalPty);
    expect(request()[3]).toBe(true);
    expect(writeTerminal).toHaveBeenCalledTimes(1);
  });

  it("an ordinary process exit does not trigger recovery or rerun startup", async () => {
    await start({ attachmentId: "saved-pty", resumeSessionId: "history" });
    await emit({ kind: "exit", sessionId: view.daemonSessionId!, exitCode: 1, reason: "normal" });
    await advance(60_000);
    expect(view.phase).toBe("exited");
    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(writeTerminal).not.toHaveBeenCalled();
    view.restart(); await flush();
    expect(request()[0].resume).toBe("history");
    expect(request()[3]).toBe(false);
  });

  it("cancels retries and ignores late events on unmount", async () => {
    await start(); const oldChannel = request()[1];
    await disconnect(); unmount();
    oldChannel.onmessage({ kind: "disconnected", sessionId: "pty-1", message: "connection reset" });
    await advance(60_000);
    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not create after restart's close resolves for an unmounted or replaced tab", async () => {
    let finishClose!: () => void;
    vi.mocked(closeTerminalTab).mockReturnValueOnce(new Promise((resolve) => { finishClose = resolve; }));
    await start(); view.restart(); view.restart();
    expect(closeTerminalTab).toHaveBeenCalledTimes(1);
    launch = { ...launch, tabId: "replacement-tab" }; await flush();
    finishClose(); await flush();
    expect(createTerminal).toHaveBeenCalledTimes(2);
    expect(request()[0].tabId).toBe("replacement-tab");
    expect(request()[3]).toBe(false);
  });

  it("does not create a replacement when closing the old PTY fails", async () => {
    await start(); await disconnect();
    vi.mocked(closeTerminalTab).mockRejectedValueOnce(new Error("close unavailable"));
    view.restart(); await flush(); await advance(60_000);
    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(view.error).toContain("close unavailable");
  });
});
