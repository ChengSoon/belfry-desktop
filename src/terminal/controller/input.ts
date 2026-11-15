import { t } from "../../i18n";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import type { Terminal } from "@xterm/xterm";
import { claimTerminalUserInput, confirmTerminalEmptyInput, finishTerminalPrompt, prepareTerminalPrompt, writeTerminal, writeTerminalInteraction, writeTerminalResponse } from "../api";
import { consumeWebClipboardPaste, listenForClipboardImagePaste, usesWebClipboardFallback } from "../clipboardPaste";
import type { CodexThemeSync } from "../codexThemeSync";
import type { PromptDeliveryOptions, TerminalInputState, TerminalLaunch, TerminalSession } from "../contracts";
import type { InteractionWrite } from "../interaction";
import { formatDroppedPaths, pointInsideRect } from "../fileDrop";
import { emptyInputLine, feedInputLine, muteInputLine } from "../inputLine";
import { pasteSettleMs, PromptInput } from "../promptInput";
import { listenForPromptUserInput } from "../promptUserInput";
import { errorMessage } from "./diagnostics";
import type { MountCallbacks } from "./types";
import { composingKey } from "../../utils/keyboard";
import type { HookSnapshot } from "../../agent/hooks/contracts";
import { ProtocolInputOwnership } from "./protocolInputOwnership";
import { TerminalResponses } from "../terminalResponses";
import { readObservedComposer } from "../composerScreen";
import { agentKindFromProfile, usesTerminalStatus, type AgentKind } from "../../agent/contracts";

/** 输出停下后再读屏幕，避免在重绘中间判定。 */
const COMPOSER_SETTLE_MS = 150;
/** 空输入框要连续稳定这么久才上报，防止回显还没画上去就误判。 */
const COMPOSER_CONFIRM_MS = 200;
/**
 * 这些键只移动光标、翻页或打断当前轮次，不会修改输入框。
 * 不包含上/下方向键：Codex / Claude 都可能用它们召回历史草稿。
 */
const PASSIVE_KEYS = new Set(["Escape", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
function passiveKey(key?: string) {
  return key !== undefined && PASSIVE_KEYS.has(key);
}

interface InputPorts {
  terminal: Terminal;
  host: HTMLDivElement;
  launch: TerminalLaunch;
  themeSync: CodexThemeSync;
  session: () => TerminalSession | null;
  callbacks: MountCallbacks;
}

export class TerminalInput {
  private readonly prompt;
  private readonly input;
  private readonly removeUserInput;
  private readonly removeImagePaste;
  private readonly webClipboard = usesWebClipboardFallback();
  private removeFileDrop: (() => void) | null = null;
  private inputLine = emptyInputLine();
  private disposed = false;
  private stopped = false;
  private readonly protocolInput: ProtocolInputOwnership;
  private readonly responses: TerminalResponses;
  private readonly agent: AgentKind | null;
  private readonly written: { dispose(): void };
  private composerTimer = 0;
  private confirmTimer = 0;

  constructor(private readonly ports: InputPorts) {
    const { terminal, host, callbacks, launch } = ports;
    this.agent = agentKindFromProfile(launch.profileId);
    this.responses = new TerminalResponses(terminal.parser, host);
    // 输出落屏后再读输入框；用户一动手就作废这次观察。
    this.written = terminal.onWriteParsed(() => this.scheduleComposerObservation());
    this.protocolInput = new ProtocolInputOwnership(this.agent);
    this.prompt = new PromptInput({
      session: () => this.session()?.id ?? null,
      paste: (text) => terminal.paste(text),
      enter: () => terminal.input("\r", true),
      write: (id, data, guarded) => writeTerminal(id, new TextEncoder().encode(data), guarded),
      respond: (id, data) => writeTerminalResponse(id, new TextEncoder().encode(data)),
      writeInteraction: writeTerminalInteraction,
      error: (error) => callbacks.onError(t("terminal.input.text_48ac6518d5", { error: errorMessage(error) })),
      settleMs: pasteSettleMs(navigator.userAgent),
      ...(usesTerminalStatus(this.agent) ? {
        prepare: prepareTerminalPrompt, finish: finishTerminalPrompt, submitting: () => this.protocolInput.beginSubmission(),
      } : {}),
    });
    this.input = terminal.onData((data) => this.onData(data));
    this.removeUserInput = listenForPromptUserInput({ terminal, host, onInput: (key) => this.userInput(key) });
    this.removeImagePaste = !this.webClipboard && launch.profileId.startsWith("agent:")
      ? listenForClipboardImagePaste(host, (sequence) => {
        if (!this.session()) return;
        this.userInput(); terminal.input(sequence, true);
      }) : null;
    terminal.attachCustomKeyEventHandler((event) => this.onKey(event));
    void getCurrentWebview().onDragDropEvent((event) => this.fileDrop(event.payload)).then((unlisten) => {
      if (this.disposed) unlisten(); else this.removeFileDrop = unlisten;
    }).catch(() => undefined);
  }

  mute() { this.inputLine = muteInputLine(this.inputLine); }
  attach(fresh: boolean, native?: TerminalInputState | null) { this.protocolInput.attach(fresh, native); }
  acceptState(snapshot: HookSnapshot) { this.protocolInput.accept(snapshot); }
  gap(nextSequence: number) { this.protocolInput.gap(nextSequence); }
  get composerEmpty() { return this.protocolInput.empty; }

  private userInput(key?: string) {
    this.cancelComposerObservation();
    this.responses.userInput();
    this.prompt.onUserInput();
    // Esc、左右移动、翻页只挪光标或打断当前轮次，不会往输入框里放字。
    // 把它们当草稿会让空终端一直显示“有未提交输入”。
    if (passiveKey(key)) return;
    const emptySubmission = this.protocolInput.isEmptySubmission(key);
    this.protocolInput.userInput(key);
    const session = this.session();
    if (session && !emptySubmission && usesTerminalStatus(this.agent)) {
      void claimTerminalUserInput(session.id).catch((error) => {
        if (this.session()?.id === session.id) this.ports.callbacks.onError(errorMessage(error));
      });
    }
  }

  private scheduleComposerObservation() {
    if (this.disposed || this.stopped || this.agent !== "codex") return;
    // 持续刷屏（转圈、标题动画）时不再重置等待：每轮只读一次，确认前再看一次最新屏幕。
    if (this.composerTimer || this.confirmTimer) return;
    this.composerTimer = window.setTimeout(() => this.observeComposer(), COMPOSER_SETTLE_MS);
  }

  private cancelComposerObservation() {
    window.clearTimeout(this.composerTimer);
    window.clearTimeout(this.confirmTimer);
    this.composerTimer = 0;
    this.confirmTimer = 0;
  }

  private observeComposer() {
    this.composerTimer = 0;
    if (!this.session() || !this.composerLooksEmpty()) return;
    // 再等一轮：如果回显只是慢了一拍，下一次读取会看到真实文字并放弃上报。
    window.clearTimeout(this.confirmTimer);
    this.confirmTimer = window.setTimeout(() => {
      this.confirmTimer = 0;
      const session = this.session();
      if (!session || !this.composerLooksEmpty()) return;
      this.protocolInput.observeEmpty();
      void confirmTerminalEmptyInput(session.id).catch(() => undefined);
    }, COMPOSER_CONFIRM_MS);
  }

  private composerLooksEmpty() {
    const requireDim = !this.ports.themeSync.usesTransparentBackground;
    return readObservedComposer(this.ports.terminal, this.agent, requireDim) === "empty";
  }

  sendText(text: string, options?: PromptDeliveryOptions) {
    if (!this.session() || !text) return false;
    if (!options?.background) this.ports.terminal.focus();
    if (!usesTerminalStatus(this.agent)) return this.prompt.sendText(text, options);
    if (!this.protocolInput.ready) return false;
    const valid = this.protocolInput.validatePosition();
    const restore = this.protocolInput.reserve();
    const accepted = this.prompt.sendText(text, { ...options, onResult: (result) => {
      if (result === "not-written") restore();
      else if (result !== "submitted") restore(true);
      options?.onResult?.(result);
    } }, valid);
    if (!accepted) restore();
    return accepted;
  }

  sendInteraction(request: InteractionWrite) { return this.prompt.sendInteraction(request); }

  get inputRevision() { return this.prompt.inputRevision; }

  stop() { this.stopped = true; this.cancelComposerObservation(); this.prompt.dispose(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.written.dispose();
    this.ports.host.classList.remove("is-file-drag-over");
    this.removeImagePaste?.();
    this.removeFileDrop?.();
    this.removeUserInput();
    this.responses.dispose();
    this.input.dispose();
  }

  private session() { return this.disposed || this.stopped ? null : this.ports.session(); }

  private onData(data: string) {
    if (!this.session()) return;
    if (this.responses.consume(data)) {
      this.prompt.onData(data, true);
      return;
    }
    this.cancelComposerObservation();
    const fed = feedInputLine(this.inputLine, data);
    this.inputLine = fed.state;
    for (const line of fed.submitted) {
      this.ports.callbacks.onInput(line);
      if (this.ports.launch.profileId !== "agent:codex" && /^(?:(?:command|exec)\s+)?codex(?:\s|$)/.test(line.trim())) {
        this.ports.themeSync.enableCodexStyles();
      }
    }
    this.prompt.onData(data);
  }

  private onKey(event: KeyboardEvent) {
    if (event.type !== "keydown" || composingKey(event)) return true;
    if (event.altKey || !(event.ctrlKey || event.metaKey)) return true;
    const key = event.key.toLowerCase();
    if (key === "v") {
      // WKWebView 继续走原生 paste，避免异步剪贴板权限按钮；Windows 保留 Ctrl+V 修复。
      if (!this.webClipboard || typeof navigator.clipboard?.readText !== "function") return true;
      return consumeWebClipboardPaste(event, () => void this.pasteClipboard());
    }
    if (key === "f") { this.ports.callbacks.onSearchRequest(); return false; }
    if (key === "c" && this.ports.terminal.hasSelection()) {
      if (typeof navigator.clipboard?.writeText !== "function") return true;
      void this.copySelection();
      return false;
    }
    return true;
  }

  private async pasteClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !this.session()) return;
      this.userInput();
      this.ports.terminal.paste(text);
    } catch { /* 权限不可用时保留原生粘贴。 */ }
  }

  private async copySelection() {
    const text = this.ports.terminal.getSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (!this.disposed) this.ports.terminal.clearSelection();
    } catch { /* 失败保留选区，仍可通过右键复制。 */ }
  }

  private fileDrop(event: DragDropEvent) {
    const { host, terminal } = this.ports;
    if (event.type === "leave") { host.classList.remove("is-file-drag-over"); return; }
    if (this.disposed) return;
    const workspace = host.closest<HTMLElement>(".terminal-workspace");
    const visible = workspace?.getAttribute("aria-hidden") !== "true";
    const point = event.position.toLogical(window.devicePixelRatio);
    const inside = visible && pointInsideRect(point, host.getBoundingClientRect());
    if (event.type === "enter" || event.type === "over") {
      host.classList.toggle("is-file-drag-over", inside); return;
    }
    host.classList.remove("is-file-drag-over");
    const session = this.session();
    if (!inside || !session) return;
    const text = formatDroppedPaths(event.paths, session);
    if (!text) return;
    terminal.focus();
    this.userInput();
    terminal.paste(text);
  }
}
