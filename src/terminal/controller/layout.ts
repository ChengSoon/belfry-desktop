import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TerminalSession } from "../contracts";
import { resizeTerminal } from "../api";
import { loadTerminalFonts } from "../fontRendering";
import { errorMessage } from "./diagnostics";

/** 低于此宽度视为布局瞬态，不能把个位数列宽传给后台。 */
const MIN_HOST_WIDTH = 80;
const RESIZE_DEBOUNCE_MS = 100;

interface LayoutPorts {
  host: HTMLDivElement;
  terminal: Terminal;
  fit: FitAddon;
  session: () => TerminalSession | null;
  update: (session: TerminalSession) => void;
  error: (message: string) => void;
}

export class TerminalLayout {
  private readonly observer: ResizeObserver;
  private frame = 0;
  private timer = 0;
  private fontVersion = 0;
  private disposed = false;

  constructor(private readonly ports: LayoutPorts) {
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(ports.host);
    this.refreshTypography();
  }

  refreshTypography() {
    if (this.disposed) return;
    const version = ++this.fontVersion;
    if (this.ports.host.clientWidth >= MIN_HOST_WIDTH) {
      this.ports.fit.fit();
      this.scheduleSync();
    }
    void loadTerminalFonts(this.ports.terminal.options).then(() => {
      if (this.disposed || version !== this.fontVersion) return;
      const { host, terminal, fit } = this.ports;
      terminal.clearTextureAtlas();
      if (host.clientWidth < MIN_HOST_WIDTH) return;
      terminal.refresh(0, Math.max(0, terminal.rows - 1));
      fit.fit();
      this.scheduleSync();
    }).catch(() => undefined);
  }

  syncSize() {
    const current = this.ports.session();
    const { terminal } = this.ports;
    if (!current || (current.cols === terminal.cols && current.rows === terminal.rows)) return;
    const next = { ...current, cols: terminal.cols, rows: terminal.rows };
    this.ports.update(next);
    void resizeTerminal(next.id, next.cols, next.rows).catch((error) => {
      if (!this.disposed && this.ports.session()?.id === next.id) this.ports.error(errorMessage(error));
    });
  }

  cancelPending() {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    window.clearTimeout(this.timer);
    this.frame = this.timer = 0;
  }

  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    this.cancelPending();
  }

  private scheduleSync() {
    window.clearTimeout(this.timer);
    if (!this.ports.session()) return;
    this.timer = window.setTimeout(() => { this.timer = 0; this.syncSize(); }, RESIZE_DEBOUNCE_MS);
  }

  private resize() {
    if (this.frame || this.disposed) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      if (this.disposed || this.ports.host.clientWidth < MIN_HOST_WIDTH) return;
      this.ports.fit.fit();
      this.scheduleSync();
    });
  }
}
