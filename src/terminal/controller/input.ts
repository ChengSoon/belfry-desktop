import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import type { Terminal } from "@xterm/xterm";
import { writeTerminal } from "../api";
import { consumeWebClipboardPaste, listenForClipboardImagePaste, usesWebClipboardFallback } from "../clipboardPaste";
import type { CodexThemeSync } from "../codexThemeSync";
import type { TerminalLaunch, TerminalSession } from "../contracts";
import { formatDroppedPaths, pointInsideRect } from "../fileDrop";
import { emptyInputLine, feedInputLine, muteInputLine } from "../inputLine";
import { PromptInput } from "../promptInput";
import { listenForPromptUserInput } from "../promptUserInput";
import { errorMessage } from "./diagnostics";
import type { MountCallbacks } from "./types";

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

  constructor(private readonly ports: InputPorts) {
    const { terminal, host, callbacks, launch } = ports;
    this.prompt = new PromptInput({
      session: () => this.session()?.id ?? null,
      paste: (text) => terminal.paste(text),
      enter: () => terminal.input("\r", true),
      write: (id, data) => writeTerminal(id, new TextEncoder().encode(data)),
      error: (error) => callbacks.onError(`终端输入失败，已停止自动提交：${errorMessage(error)}`),
    });
    this.input = terminal.onData((data) => this.onData(data));
    this.removeUserInput = listenForPromptUserInput({ terminal, host, onInput: () => this.prompt.onUserInput() });
    this.removeImagePaste = !this.webClipboard && launch.profileId.startsWith("agent:")
      ? listenForClipboardImagePaste(host, (sequence) => {
        if (!this.session()) return;
        this.prompt.onUserInput(); terminal.input(sequence, true);
      }) : null;
    terminal.attachCustomKeyEventHandler((event) => this.onKey(event));
    void getCurrentWebview().onDragDropEvent((event) => this.fileDrop(event.payload)).then((unlisten) => {
      if (this.disposed) unlisten(); else this.removeFileDrop = unlisten;
    }).catch(() => undefined);
  }

  mute() { this.inputLine = muteInputLine(this.inputLine); }

  sendText(text: string) {
    if (!this.session() || !text) return false;
    this.ports.terminal.focus();
    return this.prompt.sendText(text);
  }

  stop() { this.stopped = true; this.prompt.dispose(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.ports.host.classList.remove("is-file-drag-over");
    this.removeImagePaste?.();
    this.removeFileDrop?.();
    this.removeUserInput();
    this.input.dispose();
  }

  private session() { return this.disposed || this.stopped ? null : this.ports.session(); }

  private onData(data: string) {
    if (!this.session()) return;
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
    if (event.type !== "keydown" || event.isComposing) return true;
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
      this.prompt.onUserInput();
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
    this.prompt.onUserInput();
    terminal.paste(text);
  }
}
