import { TranslationError } from "../i18n";
import type { PromptDeliveryOptions, PromptDeliveryResult } from "./contracts";
import type { InteractionWrite, TerminalInteractionResult } from "./interaction";

/**
 * 从 PTY 粘贴写入完成后留出解析窗口。Codex 的非 bracketed paste Enter 抑制为 120ms，
 * 这里取 200ms 余量；PTY 写入完成不是应用解析完成的回执，不据此重复补发 Enter。
 */
export const PASTE_SETTLE_MS = 200;
export const WINDOWS_PASTE_SETTLE_MS = 600;

export function pasteSettleMs(userAgent: string) {
  return /Windows/iu.test(userAgent) ? WINDOWS_PASTE_SETTLE_MS : PASTE_SETTLE_MS;
}

interface PromptInputPorts {
  session: () => string | null;
  paste: (text: string) => void;
  enter: () => void;
  write: (sessionId: string, data: string) => Promise<void>;
  error: (error: unknown) => void;
  settleMs?: number;
}

/** 同步返回是否接管输入；异步失败只报告，不重贴或补发 Enter。 */
export class PromptInput {
  private tail: Promise<void> = Promise.resolve();
  private lastWrite: Promise<void> = this.tail;
  private pending = false;
  private failed = false;
  private emitting = false;
  private writeAttempts = 0;
  private revision = 0;
  private disposed = false;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private finishSettle: (() => void) | undefined;
  private captured: string[] | null = null;

  constructor(private readonly ports: PromptInputPorts) {}

  onUserInput() {
    if (!this.emitting) {
      this.revision += 1;
      this.failed = false;
    }
  }

  onData(data: string) {
    if (this.captured) { this.captured.push(data); return; }
    const sessionId = this.session();
    if (!sessionId) return;
    this.lastWrite = this.tail.then(() => {
      if (this.session() !== sessionId) throw new TranslationError("terminal.promptInput.text_76e5a39b93");
      this.writeAttempts += 1;
      return this.ports.write(sessionId, data);
    });
    this.tail = this.lastWrite.catch((error) => {
      if (this.session() !== sessionId) return;
      this.failed = true;
      this.ports.error(error);
    });
  }

  sendText(text: string, options?: PromptDeliveryOptions): boolean {
    const sessionId = this.session();
    if (!sessionId || !text || this.pending || this.failed) return false;
    this.pending = true;
    const revision = this.revision;
    void this.submit(text, sessionId, revision).then((result) => {
      this.pending = false;
      options?.onResult?.(result);
    });
    return true;
  }

  /** Shares the keyboard queue; its validity check runs after older writes finish. */
  sendInteraction(request: InteractionWrite): Promise<TerminalInteractionResult> {
    const sessionId = this.session();
    if (!sessionId) return Promise.resolve({ status: "unavailable" });
    if (this.pending) return Promise.resolve({ status: "busy" });
    if (this.failed) return Promise.resolve({ status: "failed" });
    this.pending = true;
    const revision = this.revision;
    const submission = this.tail.then(() => this.submitInteraction(request, sessionId, revision));
    this.tail = submission.then(() => undefined);
    return submission.finally(() => { this.pending = false; });
  }

  private emit(action: () => void) {
    this.emitting = true;
    try { action(); } finally { this.emitting = false; }
  }

  dispose() {
    this.disposed = true;
    this.revision += 1;
    clearTimeout(this.settleTimer);
    this.finishSettle?.();
  }

  private session() { return this.disposed ? null : this.ports.session(); }

  private settle() {
    return new Promise<void>((resolve) => {
      this.finishSettle = () => { this.finishSettle = undefined; this.settleTimer = undefined; resolve(); };
      this.settleTimer = setTimeout(this.finishSettle, this.ports.settleMs ?? PASTE_SETTLE_MS);
    });
  }

  private encoded(action: () => void): string {
    this.captured = [];
    try { this.emit(action); return this.captured.join(""); }
    finally { this.captured = null; }
  }

  private async submitInteraction(request: InteractionWrite, sessionId: string, revision: number): Promise<TerminalInteractionResult> {
    let attempted = false;
    const attached = () => this.session() === sessionId;
    const untouched = () => this.revision === revision && !this.failed;
    const write = async (data: string) => {
      if (!data) throw new Error("The terminal did not encode the requested input.");
      attempted = true;
      this.writeAttempts += 1;
      await this.ports.write(sessionId, data);
    };
    try {
      if (!attached()) return { status: "unavailable" };
      if (!untouched() || !request.valid()) return { status: "changed" };
      if (request.navigation) {
        await write(request.navigation);
        if (!attached() || !untouched() || !await request.navigationReady?.()) return { status: "uncertain" };
        // Never send Enter based solely on an assumed arrow/space key mapping.
        if (!attached() || !untouched() || !request.validAfterNavigation?.()) return { status: "uncertain" };
      }
      if (request.keys) await write(request.keys);
      if (request.text !== undefined) {
        if (!attached() || !untouched()) return { status: attempted ? "uncertain" : "changed" };
        const pasted = this.encoded(() => this.ports.paste(request.text!));
        // A raw multi-line paste can submit before validation. Require bracketed paste.
        if (/[\r\n]/.test(request.text) && !pasted.startsWith("\u001b[200~")) return { status: attempted ? "uncertain" : "invalid" };
        await write(pasted);
        await this.settle();
        if (!attached() || !untouched() || !(request.validAfterPaste ?? request.valid)()) return { status: "uncertain" };
        await write(this.encoded(() => this.ports.enter()));
      }
      return { status: attached() ? "sent" : "uncertain" };
    } catch (error) {
      if (attached()) { this.failed = true; this.ports.error(error); }
      return { status: attempted ? "uncertain" : "failed" };
    }
  }

  private async submit(text: string, sessionId: string, revision: number): Promise<PromptDeliveryResult> {
    const attempts = this.writeAttempts;
    const detached = (): PromptDeliveryResult => this.writeAttempts === attempts ? "not-written" : "detached";
    try {
      this.emit(() => this.ports.paste(text));
      await this.lastWrite;
      if (this.session() !== sessionId) return detached();
      await this.settle();
      if (this.session() !== sessionId) return detached();
      if (this.failed) return "failed";
      // 用户在等待窗口输入或手动回车后，不再自动提交，以免提交两次或混入其他输入。
      if (this.revision !== revision) return "cancelled";
      this.emit(() => this.ports.enter());
      await this.lastWrite;
      return "submitted";
    } catch (error) {
      // write 的失败已由队列报告；paste/input 同步异常也必须可见。
      if (!this.failed && this.session() === sessionId) {
        this.failed = true;
        this.ports.error(error);
      }
      return this.session() === sessionId ? "failed" : detached();
    }
  }
}
