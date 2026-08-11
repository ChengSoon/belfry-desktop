import { Channel } from "@tauri-apps/api/core";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import type { TerminalTheme } from "../theme/xtermTheme";
import { watchActivity } from "./activity";
import {
  closeTerminal,
  createTerminal,
  resizeTerminal,
  setTerminalPalette,
  writeTerminal,
} from "./api";
import { listenForClipboardImagePaste, usesWebClipboardFallback } from "./clipboardPaste";
import { CodexThemeSync } from "./codexThemeSync";
import {
  createTerminalRequest,
  type SessionActivity,
  type TerminalEvent,
  type TerminalLaunch,
  type TerminalPalette,
  type TerminalPhase,
  type TerminalSession,
} from "./contracts";
import { emptyInputLine, feedInputLine, muteInputLine } from "./inputLine";
import { formatDroppedPaths, pointInsideRect } from "./fileDrop";
import { looksLikePasswordPrompt } from "./passwordPrompt";
import { acceptSequence } from "./sequence";

/** 低于此宽度视为布局瞬态，不下发 resize。约等于 10 列等宽字符。 */
const MIN_HOST_WIDTH = 80;

/** 探测密码提示时只解码输出块的尾部：TUI 全屏刷新一次能吐几十 KB，而提示总在块尾。 */
const PROMPT_TAIL_BYTES = 200;

export interface MountCallbacks {
  onPhase: (phase: TerminalPhase) => void;
  onError: (error: string | null) => void;
  onSession: (session: TerminalSession | null) => void;
  /** 用户提交的一行原始输入，供上层提炼会话名。 */
  onInput: (line: string) => void;
  /** 会话在生成 / 等按键 / 闲着，供侧栏显示。只有 Agent 会话会翻。 */
  onActivity: (activity: SessionActivity) => void;
}

export interface TerminalHandle {
  /** 换肤走这里，不要重新挂载：重挂会连带杀掉底层 PTY 会话。 */
  applyTheme: (theme: TerminalTheme) => void;
  dispose: () => void;
}

export function mountTerminal(
  host: HTMLDivElement,
  launch: TerminalLaunch,
  theme: TerminalTheme,
  callbacks: MountCallbacks,
): TerminalHandle {
  const terminal = createXterm(theme);
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host);
  let disposed = false;
  const useWebClipboard = usesWebClipboardFallback();
  const codexThemeSync = launch.profileId === "agent:codex" ? new CodexThemeSync(theme) : null;
  // Tauri's Windows WebView can consume Ctrl+V as a control character instead of
  // dispatching the native `paste` event. Claude Code runs in raw mode and is
  // particularly affected: it receives ^V, but no clipboard contents. Read the
  // clipboard while the key gesture still has user activation and feed it through
  // xterm's paste API so bracketed-paste mode is preserved.
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown" || event.isComposing) return true;
    if (event.altKey || !(event.ctrlKey || event.metaKey)) return true;
    const key = event.key.toLowerCase();
    if (key === "v") {
      // macOS 的 WKWebView 会把异步 readText() 变成一个可见的 Paste 权限按钮。
      // 让它走可信的原生 paste 事件；图片载荷会在下面转成终端 Ctrl+V。
      if (!useWebClipboard) return true;
      if (typeof navigator.clipboard?.readText !== "function") return true;
      void pasteClipboard(terminal);
      return false;
    }
    /* Ctrl+C 在终端里本来就是 SIGINT，但用户按下它时多半只是想复制刚选中的那段。
       按选区分流：有选区就复制，没选区才把 ^C 发下去——想中断的时候通常没在选东西。
       复制完清掉选区是关键：否则选区一直在，之后每一次 Ctrl+C 都被判成复制，
       中断就再也发不出去了。清掉之后紧接着再按一次就是正常的 SIGINT。 */
    if (key === "c" && terminal.hasSelection()) {
      if (typeof navigator.clipboard?.writeText !== "function") return true;
      void copySelection(terminal);
      return false;
    }
    return true;
  });
  const renderer = attachWebglRenderer(terminal);
  fit.fit();
  callbacks.onPhase("creating");
  callbacks.onError(null);
  callbacks.onSession(null);
  // 重启（generation++）会重挂到同一个 tab 上，不清一次就带着上个 PTY 的状态点起步。
  callbacks.onActivity("idle");

  let current: TerminalSession | null = null;
  const removeImagePasteListener = !useWebClipboard && launch.profileId.startsWith("agent:")
    ? listenForClipboardImagePaste(host, (sequence) => terminal.input(sequence, true))
    : null;
  let expectedSequence = 0;
  let writeQueue = Promise.resolve();
  let inputLine = emptyInputLine();
  // Shell 会话不猜状态：它没有"对话"这回事，而 cat 一个含 `1. Yes` 的文件必然误报。
  let activity = launch.profileId.startsWith("agent:")
    ? watchActivity(terminal, callbacks.onActivity)
    : null;
  const exitedSessions = new Set<string>();
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = (event) => {
    if (disposed) return;
    try {
      expectedSequence = handleTerminalEvent(
        terminal,
        callbacks,
        event,
        expectedSequence,
        codexThemeSync,
      );
      // 停在密码提示上就静默采集，否则 sudo 密码会被当成最新一条输入写进会话名。
      if (event.kind === "output" && looksLikePasswordPrompt(decodeTail(event.bytes))) {
        inputLine = muteInputLine(inputLine);
      }
    } catch (error) {
      callbacks.onError(errorMessage(error));
      callbacks.onPhase("error");
      if (current) void closeTerminal(current.id).catch(() => undefined);
    }
    if (event.kind === "exit") {
      exitedSessions.add(event.sessionId);
      current = null;
      // 进程没了就停止猜：最后一屏还停在 spinner 上，再扫一次会把状态永久钉在"正在对话"。
      activity?.dispose();
      activity = null;
      callbacks.onActivity("idle");
    }
  };

  const input = terminal.onData((data) => {
    if (!current) return;
    const currentId = current.id;
    const bytes = new TextEncoder().encode(data);
    const fed = feedInputLine(inputLine, data);
    inputLine = fed.state;
    for (const line of fed.submitted) callbacks.onInput(line);
    writeQueue = writeQueue
      .then(() => writeTerminal(currentId, bytes))
      .catch((error) => callbacks.onError(errorMessage(error)));
  });
  let removeFileDropListener: (() => void) | null = null;
  void getCurrentWebview().onDragDropEvent((event) => {
    handleFileDropEvent(event.payload, host, terminal, current);
  }).then((unlisten) => {
    if (disposed) unlisten();
    else removeFileDropListener = unlisten;
  }).catch(() => undefined);
  const observer = createResizeObserver(host, terminal, fit, () => current, callbacks);
  void startSession(terminal, fit, channel, launch, theme, callbacks).then((value) => {
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
    applyTheme: (next) => {
      codexThemeSync?.setTheme(next);
      terminal.options.theme = next;
      // PTY 层也得跟着换：换肤之后再启动的程序会重新查一次背景色。
      if (current) void setTerminalPalette(current.id, toPalette(next)).catch(() => undefined);
      if (current && codexThemeSync) {
        terminal.write("", () => void requestCodexRedraw(current, terminal));
      }
    },
    dispose: () => {
      disposed = true;
      host.classList.remove("is-file-drag-over");
      removeImagePasteListener?.();
      removeFileDropListener?.();
      observer.disconnect();
      input.dispose();
      activity?.dispose();
      if (current) void closeTerminal(current.id).catch(() => undefined);
      renderer?.dispose();
      terminal.dispose();
    },
  };
}

function handleFileDropEvent(
  event: DragDropEvent,
  host: HTMLDivElement,
  terminal: Terminal,
  session: TerminalSession | null,
) {
  if (event.type === "leave") {
    host.classList.remove("is-file-drag-over");
    return;
  }

  const workspace = host.closest<HTMLElement>(".terminal-workspace");
  const visible = workspace?.getAttribute("aria-hidden") !== "true";
  const point = event.position.toLogical(window.devicePixelRatio);
  const inside = visible && pointInsideRect(point, host.getBoundingClientRect());

  if (event.type === "enter" || event.type === "over") {
    host.classList.toggle("is-file-drag-over", inside);
    return;
  }

  host.classList.remove("is-file-drag-over");
  if (!inside || !session) return;
  const text = formatDroppedPaths(event.paths, session);
  if (!text) return;
  terminal.focus();
  // paste() 会遵守应用开启的 bracketed-paste mode，路径只进入输入区，不会自动执行。
  terminal.paste(text);
}

async function pasteClipboard(terminal: Terminal) {
  try {
    const clipboard = navigator.clipboard;
    const text = await clipboard.readText();
    if (text) terminal.paste(text);
  } catch {
    // Clipboard access may be unavailable in a locked-down WebView. In that case
    // leave the terminal untouched; native context-menu paste remains available.
  }
}

/** 复制成功才清选区：写剪贴板失败时留着选区，用户还能用右键菜单复制。 */
async function copySelection(terminal: Terminal) {
  const text = terminal.getSelection();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    terminal.clearSelection();
  } catch {
    // 同 pasteClipboard：WebView 可能禁掉了剪贴板权限，静默退回原生复制。
  }
}

function toPalette(theme: TerminalTheme): TerminalPalette {
  return { foreground: theme.foreground, background: theme.background };
}

async function startSession(
  terminal: Terminal,
  fit: FitAddon,
  channel: Channel<TerminalEvent>,
  launch: TerminalLaunch,
  theme: TerminalTheme,
  callbacks: MountCallbacks,
) {
  try {
    fit.fit();
    return await createTerminal(
      createTerminalRequest(terminal.cols, terminal.rows, launch, toPalette(theme)),
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
  codexThemeSync: CodexThemeSync | null,
) {
  if (event.kind === "output") {
    const next = acceptSequence(expectedSequence, event.sequence);
    const bytes = codexThemeSync?.rewrite(event.bytes, event.eof) ?? event.bytes;
    if (bytes.length > 0) terminal.write(new Uint8Array(bytes));
    return next;
  }
  const held = codexThemeSync?.flush() ?? [];
  if (held.length > 0) terminal.write(new Uint8Array(held));
  callbacks.onPhase("exited");
  callbacks.onSession(null);
  terminal.write(`\r\n\x1b[90m[process exited ${event.exitCode}]\x1b[0m\r\n`);
  return expectedSequence;
}

/** 尺寸恢复后 Codex 会完整重绘，新的输入区背景才能覆盖 xterm 缓冲区里的旧颜色。 */
async function requestCodexRedraw(session: TerminalSession | null, terminal: Terminal) {
  if (!session || terminal.cols <= 1) return;
  const sessionId = session.id;
  try {
    await resizeTerminal(sessionId, terminal.cols - 1, terminal.rows);
    await resizeTerminal(sessionId, terminal.cols, terminal.rows);
  } catch {
    // 会话可能恰好退出；主题本身已经切换成功，不把辅助重绘失败升级成错误提示。
  }
}

const tailDecoder = new TextDecoder();

/** 截断处的多字节序列会解成 U+FFFD，不影响提示词匹配。 */
function decodeTail(bytes: number[]) {
  const tail = bytes.length > PROMPT_TAIL_BYTES ? bytes.slice(-PROMPT_TAIL_BYTES) : bytes;
  return tailDecoder.decode(new Uint8Array(tail));
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

function createXterm(theme: TerminalTheme) {
  // 配色必须在构造时就位：会话创建请求要带上背景色，而它在挂载的同一个同步块里就发出去了。
  return new Terminal({
    allowTransparency: false,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 4,
    fontFamily: monoFontFamily(),
    fontSize: 13,
    fontWeight: 400,
    fontWeightBold: 500,
    lineHeight: 1.35,
    scrollback: 1000,
    theme,
  });
}

/* 必须走 WebGL renderer，不是为了性能而是为了画对块字符。
   默认的 DOM renderer 把每格渲染成一个 span：格子背景铺满整格，字形只占字体的 em 盒，
   lineHeight 1.35 多出来的那 35% 行距没有字形覆盖，于是格子背景从字形上下露出来。
   ▀▄█▛▜ 这类块元素本该严丝合缝拼成图形，露出来就断成一条条横缝。
   Claude Code 的 Clawd 吉祥物给那几格显式设了黑底（clawd_background: rgb(0,0,0)），
   缝隙露的就是黑块——亮色主题下尤其刺眼。
   WebGL renderer 对这些码位不走字体，直接按矢量定义铺满整格，无论行高都不留缝。

   拿不到 WebGL 就静默退回 DOM renderer：块字符会难看，但终端本身照常能用，
   为了画得好看而让会话开不起来是不划算的。 */
function attachWebglRenderer(terminal: Terminal) {
  try {
    const addon = new WebglAddon();
    // 丢上下文后 addon 自己不会恢复，继续挂着只会得到一块空白画布。
    // 卸掉它，xterm 自动落回 DOM renderer。
    addon.onContextLoss(() => addon.dispose());
    terminal.loadAddon(addon);
    return addon;
  } catch {
    return null;
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const code = "code" in error ? `[${String(error.code)}] ` : "";
    return `${code}${String(error.message)}`;
  }
  return String(error);
}
