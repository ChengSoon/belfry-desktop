import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import { closeTerminal, createTerminal, resizeTerminal, writeTerminal } from "./api";
import {
  createTerminalRequest,
  type TerminalEvent,
  type TerminalLaunch,
  type TerminalPhase,
  type TerminalSession,
} from "./contracts";
import { acceptSequence } from "./sequence";

/** 低于此宽度视为布局瞬态，不下发 resize。约等于 10 列等宽字符。 */
const MIN_HOST_WIDTH = 80;

export interface MountCallbacks {
  onPhase: (phase: TerminalPhase) => void;
  onError: (error: string | null) => void;
  onSession: (session: TerminalSession | null) => void;
}

export interface TerminalHandle {
  /** 换肤走这里，不要重新挂载：重挂会连带杀掉底层 PTY 会话。 */
  applyTheme: (theme: ITheme) => void;
  dispose: () => void;
}

export function mountTerminal(
  host: HTMLDivElement,
  launch: TerminalLaunch,
  callbacks: MountCallbacks,
): TerminalHandle {
  const terminal = createXterm();
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host);
  fit.fit();
  callbacks.onPhase("creating");
  callbacks.onError(null);
  callbacks.onSession(null);

  let disposed = false;
  let current: TerminalSession | null = null;
  let expectedSequence = 0;
  let writeQueue = Promise.resolve();
  const exitedSessions = new Set<string>();
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = (event) => {
    if (disposed) return;
    try {
      expectedSequence = handleTerminalEvent(terminal, callbacks, event, expectedSequence);
    } catch (error) {
      callbacks.onError(errorMessage(error));
      callbacks.onPhase("error");
      if (current) void closeTerminal(current.id).catch(() => undefined);
    }
    if (event.kind === "exit") {
      exitedSessions.add(event.sessionId);
      current = null;
    }
  };

  const input = terminal.onData((data) => {
    if (!current) return;
    const currentId = current.id;
    const bytes = new TextEncoder().encode(data);
    writeQueue = writeQueue
      .then(() => writeTerminal(currentId, bytes))
      .catch((error) => callbacks.onError(errorMessage(error)));
  });
  const observer = createResizeObserver(host, terminal, fit, () => current, callbacks);
  void startSession(terminal, fit, channel, launch, callbacks).then((value) => {
    if (disposed) {
      if (value) void closeTerminal(value.id).catch(() => undefined);
      return;
    }
    if (value && !exitedSessions.has(value.id)) {
      current = value;
      callbacks.onSession(value);
      callbacks.onPhase("running");
      terminal.focus();
    }
  });

  return {
    applyTheme: (theme) => {
      terminal.options.theme = theme;
    },
    dispose: () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      if (current) void closeTerminal(current.id).catch(() => undefined);
      terminal.dispose();
    },
  };
}

async function startSession(
  terminal: Terminal,
  fit: FitAddon,
  channel: Channel<TerminalEvent>,
  launch: TerminalLaunch,
  callbacks: MountCallbacks,
) {
  try {
    fit.fit();
    return await createTerminal(
      createTerminalRequest(terminal.cols, terminal.rows, launch),
      channel,
    );
  } catch (error) {
    callbacks.onError(errorMessage(error));
    callbacks.onPhase("error");
    return null;
  }
}

function handleTerminalEvent(
  terminal: Terminal,
  callbacks: MountCallbacks,
  event: TerminalEvent,
  expectedSequence: number,
) {
  if (event.kind === "output") {
    const next = acceptSequence(expectedSequence, event.sequence);
    if (event.bytes.length > 0) terminal.write(new Uint8Array(event.bytes));
    return next;
  }
  callbacks.onPhase("exited");
  callbacks.onSession(null);
  terminal.write(`\r\n\x1b[90m[process exited ${event.exitCode}]\x1b[0m\r\n`);
  return expectedSequence;
}

function createResizeObserver(
  host: HTMLDivElement,
  terminal: Terminal,
  fit: FitAddon,
  getSession: () => TerminalSession | null,
  callbacks: MountCallbacks,
) {
  let timer = 0;
  let lastSize = `${terminal.cols}x${terminal.rows}`;
  const observer = new ResizeObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      // 容器瞬时坍缩（折叠侧栏、窗口最小化）时 fit 会算出个位数列宽，
      // 一旦推给 PTY，shell 会按这个宽度折行，之后即使布局恢复也留下断行。
      if (host.clientWidth < MIN_HOST_WIDTH) return;
      fit.fit();
      const session = getSession();
      const size = `${terminal.cols}x${terminal.rows}`;
      if (!session || size === lastSize) return;
      lastSize = size;
      callbacks.onSession({ ...session, cols: terminal.cols, rows: terminal.rows });
      void resizeTerminal(session.id, terminal.cols, terminal.rows).catch((error) => {
        callbacks.onError(errorMessage(error));
      });
    }, 50);
  });
  observer.observe(host);
  return observer;
}

/* 字体清单只在 styles.css 的 --font-mono 里维护一份，这里读出来喂给 xterm。
   xterm 只接受字符串，拿不到就退回一个能跑的最小栈。 */
function monoFontFamily() {
  const fromCss = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-mono")
    .trim();
  return fromCss || 'ui-monospace, "SFMono-Regular", Consolas, monospace';
}

function createXterm() {
  // 配色不在这里写死：挂载后由 useTerminalSession 立即注入当前主题的调色板。
  return new Terminal({
    allowTransparency: false,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: "bar",
    fontFamily: monoFontFamily(),
    fontSize: 13,
    fontWeight: 400,
    fontWeightBold: 500,
    lineHeight: 1.35,
    scrollback: 1000,
  });
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const code = "code" in error ? `[${String(error.code)}] ` : "";
    return `${code}${String(error.message)}`;
  }
  return String(error);
}
