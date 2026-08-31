import { Channel } from "@tauri-apps/api/core";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import type { TerminalTheme } from "../theme/xtermTheme";
import { withTransparentBackground } from "../theme/xtermTheme";
import type { TypographyRuntime } from "../typography/contracts";
import { typographyFontStacks } from "../typography/storage";
import { watchActivity } from "./activity";
import {
  closeTerminal,
  createTerminal,
  resizeTerminal,
  setTerminalPalette,
  writeTerminal,
} from "./api";
import {
  consumeWebClipboardPaste,
  listenForClipboardImagePaste,
  usesWebClipboardFallback,
} from "./clipboardPaste";
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
import { registerFileLinkProvider, registerHttpLinkProvider } from "./links";
import { TerminalSearchController } from "./search";
import { configureUnicode } from "./unicode";

/** 低于此宽度视为布局瞬态，不下发 resize。约等于 10 列等宽字符。 */
const MIN_HOST_WIDTH = 80;
const RESIZE_DEBOUNCE_MS = 100;

/** 探测密码提示时只解码输出块的尾部：TUI 全屏刷新一次能吐几十 KB，而提示总在块尾。 */
const PROMPT_TAIL_BYTES = 200;

export interface MountCallbacks {
  onPhase: (phase: TerminalPhase) => void;
  onError: (error: string | null) => void;
  onSession: (session: TerminalSession | null) => void;
  /** 用户提交的一行原始输入，供上层提炼会话名。 */
  onInput: (line: string) => void;
  /** 终端输出的文本片段，供协作协议等结构化通道消费。 */
  onOutput?: (text: string) => void;
  /** 会话在生成 / 等按键 / 闲着，供侧栏显示。只有 Agent 会话会翻。 */
  onActivity: (activity: SessionActivity) => void;
  /** 终端输出中的项目文件路径，交给工作区打开只读预览。 */
  onOpenFile: (path: string, line: number | null) => void;
  /** Ctrl/Cmd+F 请求打开搜索浮层，由 React 负责呈现。 */
  onSearchRequest: () => void;
}

export interface TerminalHandle {
  /**
   * 换肤走这里，不要重新挂载：重挂会连带杀掉底层 PTY 会话。
   *
   * `theme` 始终传**不透明的基准主题**，是否透明由 `transparent` 单独给。
   * 背景色有三个下游只认 `#rrggbb`——PTY 的 OSC 应答、Codex 的输入区配色、
   * 以及会话创建请求——把 rgba 混进来会静默失效或直接抛错。
   */
  applyTheme: (theme: TerminalTheme, transparent: boolean) => void;
  /** 字体变化只刷新 xterm 并重新 fit，不能重挂终端，否则会杀掉 PTY。 */
  applyTypography: (config: TypographyRuntime) => void;
  search: TerminalSearchController;
  focus: () => void;
  /** Composer 走可信的 xterm 输入通道提交多行文本，不直接绕过终端写 PTY。 */
  sendText: (text: string) => boolean;
  dispose: () => void;
}

export function mountTerminal(
  host: HTMLDivElement,
  launch: TerminalLaunch,
  theme: TerminalTheme,
  transparent: boolean,
  typography: TypographyRuntime,
  callbacks: MountCallbacks,
): TerminalHandle {
  const terminal = createXterm(theme, transparent, typography);
  configureUnicode(terminal);
  const linkProvider = registerHttpLinkProvider(terminal);
  const fileLinkProvider = registerFileLinkProvider(terminal, callbacks.onOpenFile);
  const search = new TerminalSearchController(terminal);
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host);
  let disposed = false;
  let typographyVersion = 0;
  let typographyResizeTimer = 0;
  const useWebClipboard = usesWebClipboardFallback();
  const isCodexProfile = launch.profileId === "agent:codex";
  // 所有会话都过滤透明 WebGL 的 dim 白块；Shell 提交 codex 命令或输出 Codex banner 后，
  // 同步器再切到完整配色规则，普通 TUI 在此之前保持原样。
  const codexThemeSync = new CodexThemeSync(theme, transparent, isCodexProfile);
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
      return consumeWebClipboardPaste(event, () => void pasteClipboard(terminal));
    }
    if (key === "f") {
      callbacks.onSearchRequest();
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
  const scheduleTypographyResize = () => {
    window.clearTimeout(typographyResizeTimer);
    typographyResizeTimer = window.setTimeout(() => {
      current = syncTerminalSize(terminal, current, callbacks);
    }, RESIZE_DEBOUNCE_MS);
  };
  const removeImagePasteListener = !useWebClipboard && launch.profileId.startsWith("agent:")
    ? listenForClipboardImagePaste(host, (sequence) => terminal.input(sequence, true))
    : null;
  let expectedSequence = 0;
  let writeQueue = Promise.resolve();
  const outputDecoder = new TextDecoder();
  let outputTail = "";
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
      const handled = handleTerminalEvent(
        terminal,
        callbacks,
        event,
        expectedSequence,
        codexThemeSync,
        outputDecoder,
      );
      expectedSequence = handled.expectedSequence;
      if (handled.outputText.length > 0) {
        outputTail = appendOutputTail(outputTail, handled.outputText);
        callbacks.onOutput?.(handled.outputText);
      }
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
      callbacks.onError(diagnoseTerminalExit(event.exitCode, outputTail));
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
    for (const line of fed.submitted) {
      callbacks.onInput(line);
      if (!isCodexProfile && isCodexCommand(line)) codexThemeSync.enableCodexStyles();
    }
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
    applyTheme: (next, transparent) => {
      // 这两处都只认 #rrggbb，喂基准主题：CodexThemeSync 的 parseHex 遇到 rgba 会直接抛，
      // 而 PTY 那边的解析失败是静默的——OSC 11 查询得不到应答，只在个别 TUI 里表现为配色错乱。
      codexThemeSync.setTheme(next, transparent);
      terminal.options.allowTransparency = transparent;
      terminal.options.theme = transparent ? withTransparentBackground(next) : next;
      // PTY 层也得跟着换：换肤之后再启动的程序会重新查一次背景色。
      if (current) void setTerminalPalette(current.id, toPalette(next)).catch(() => undefined);
      if (current && codexThemeSync.codexStylesEnabled) {
        terminal.write("", () => void requestCodexRedraw(current, terminal));
      }
    },
    applyTypography: (next) => {
      const version = ++typographyVersion;
      applyTypographyOptions(terminal, next);
      if (host.clientWidth >= MIN_HOST_WIDTH) {
        fit.fit();
        scheduleTypographyResize();
      }
      void loadTerminalFont(next).then(() => {
        if (disposed || version !== typographyVersion) return;
        terminal.clearTextureAtlas();
        if (host.clientWidth < MIN_HOST_WIDTH) return;
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
        fit.fit();
        scheduleTypographyResize();
      }).catch(() => undefined);
    },
    search,
    focus: () => terminal.focus(),
    sendText: (text) => {
      if (disposed || !current || !text) return false;
      terminal.focus();
      // paste() 保留多行内容并遵守 bracketed-paste；回车放在 paste 之外才会真正提交。
      terminal.paste(text);
      terminal.input("\r", true);
      return true;
    },
    dispose: () => {
      disposed = true;
      host.classList.remove("is-file-drag-over");
      removeImagePasteListener?.();
      removeFileDropListener?.();
      window.clearTimeout(typographyResizeTimer);
      observer.disconnect();
      input.dispose();
      activity?.dispose();
      if (current) void closeTerminal(current.id).catch(() => undefined);
      renderer?.dispose();
      linkProvider.dispose();
      fileLinkProvider.dispose();
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
  codexThemeSync: CodexThemeSync,
  outputDecoder: TextDecoder,
) {
  if (event.kind === "output") {
    const next = acceptSequence(expectedSequence, event.sequence);
    const bytes = codexThemeSync.rewrite(event.bytes, event.eof);
    if (bytes.length > 0) terminal.write(new Uint8Array(bytes));
    const text = outputDecoder.decode(new Uint8Array(bytes), { stream: !event.eof });
    return { expectedSequence: next, outputText: text };
  }
  const held = codexThemeSync.flush();
  if (held.length > 0) terminal.write(new Uint8Array(held));
  callbacks.onPhase("exited");
  callbacks.onSession(null);
  terminal.write(`\r\n\x1b[90m[process exited ${event.exitCode}]\x1b[0m\r\n`);
  return { expectedSequence, outputText: "" };
}

const MAX_OUTPUT_TAIL = 16_384;

function appendOutputTail(previous: string, next: string) {
  const combined = previous + next;
  return combined.length > MAX_OUTPUT_TAIL ? combined.slice(-MAX_OUTPUT_TAIL) : combined;
}

/** 将 CLI 启动失败从“终端已退出”提升为用户可执行的诊断。 */
export function diagnoseTerminalExit(exitCode: number, output: string): string | null {
  if (exitCode === 0) return null;
  const clean = stripTerminalAnsi(output).replace(/\r/g, "\n");
  if (/readonly database|read-only database|local database appears to be damaged|failed to initialize state/i.test(clean)) {
    return "Agent 启动失败：Codex 无法写入本地状态数据库（~/.codex/state_5.sqlite）。请检查 ~/.codex 的读写权限后重试。";
  }
  const lines = clean
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const detail = [...lines].reverse().find((line) => /^(error|fatal|错误|失败)[:：]?/i.test(line) || /couldn't start|operation not permitted|failed to initialize/i.test(line));
  return detail ? `Agent 启动失败：${detail}` : `Agent 进程已退出（代码 ${exitCode}）`;
}

function stripTerminalAnsi(value: string) {
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "");
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

function isCodexCommand(line: string) {
  return /^(?:(?:command|exec)\s+)?codex(?:\s|$)/.test(line.trim());
}

function createResizeObserver(
  host: HTMLDivElement,
  terminal: Terminal,
  fit: FitAddon,
  getSession: () => TerminalSession | null,
  callbacks: MountCallbacks,
) {
  let frame = 0;
  let resizeTimer = 0;
  let lastSize = `${terminal.cols}x${terminal.rows}`;
  const observer = new ResizeObserver(() => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      // 容器瞬时坍缩（折叠侧栏、窗口最小化）时 fit 会算出个位数列宽，
      // 一旦推给 PTY，shell 会按这个宽度折行，之后即使布局恢复也留下断行。
      if (host.clientWidth < MIN_HOST_WIDTH) return;

      // 画布尺寸必须跟布局同帧更新，否则拖动侧栏时 WebGL 会短暂拉伸旧画面。
      fit.fit();
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const session = getSession();
        const size = `${terminal.cols}x${terminal.rows}`;
        if (!session || size === lastSize) return;
        lastSize = size;
        callbacks.onSession({ ...session, cols: terminal.cols, rows: terminal.rows });
        void resizeTerminal(session.id, terminal.cols, terminal.rows).catch((error) => {
          callbacks.onError(errorMessage(error));
        });
      }, RESIZE_DEBOUNCE_MS);
    });
  });
  observer.observe(host);
  return {
    disconnect() {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(resizeTimer);
    },
  };
}

function createXterm(
  theme: TerminalTheme,
  transparent: boolean,
  typography: TypographyRuntime,
) {
  // 配色必须在构造时就位：会话创建请求要带上背景色，而它在挂载的同一个同步块里就发出去了。
  return new Terminal({
    // Unicode provider 使用 xterm 的 proposed API；不显式开启时，首个终端挂载会抛异常并导致整页白屏。
    allowProposedApi: true,
    // 开背景图时必须打开，否则 xterm 会把底色实心涂满、图整个被盖住。
    // 官方说明它对性能有影响，所以没背景图时照旧关着。
    allowTransparency: transparent,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 4,
    fontFamily: typographyFontStacks(typography.fontFamily).mono,
    fontSize: typography.fontSize,
    fontWeight: 400,
    fontWeightBold: 500,
    lineHeight: 1.35,
    // 自绘滚动条宽度。默认 14px 在窄窗格里太占地方，收到 8px；
    // 这个值同时控制滚动条与 overview ruler 的宽度（xterm 内部共用）。
    overviewRuler: { width: 8 },
    scrollback: 1000,
    theme: transparent ? withTransparentBackground(theme) : theme,
  });
}

function applyTypographyOptions(
  terminal: Terminal,
  config: TypographyRuntime,
) {
  terminal.options.fontFamily = typographyFontStacks(config.fontFamily).mono;
  terminal.options.fontSize = config.fontSize;
  terminal.clearTextureAtlas();
}

function syncTerminalSize(
  terminal: Terminal,
  current: TerminalSession | null,
  callbacks: MountCallbacks,
): TerminalSession | null {
  if (!current || (current.cols === terminal.cols && current.rows === terminal.rows)) return current;
  const next = { ...current, cols: terminal.cols, rows: terminal.rows };
  callbacks.onSession(next);
  void resizeTerminal(next.id, next.cols, next.rows).catch((error) => {
    callbacks.onError(errorMessage(error));
  });
  return next;
}

function loadTerminalFont(config: TypographyRuntime): Promise<FontFace[]> {
  if (!document.fonts) return Promise.resolve([]);
  const family = typographyFontStacks(config.fontFamily).mono;
  return document.fonts.load(`${config.fontSize}px ${family}`);
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
