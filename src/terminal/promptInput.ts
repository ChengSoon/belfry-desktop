/**
 * 从 PTY 粘贴写入完成后留出解析窗口。Codex 的非 bracketed paste Enter 抑制为 120ms，
 * 这里取 200ms 余量；PTY 写入完成不是应用解析完成的回执，不据此重复补发 Enter。
 */
export const PASTE_SETTLE_MS = 200;

interface PromptInputPorts {
  session: () => string | null;
  paste: (text: string) => void;
  enter: () => void;
  write: (sessionId: string, data: string) => Promise<void>;
  error: (error: unknown) => void;
}

/** 同步返回是否接管输入；异步失败只报告，不重贴或补发 Enter。 */
export class PromptInput {
  private tail: Promise<void> = Promise.resolve();
  private lastWrite: Promise<void> = this.tail;
  private pending = false;
  private failed = false;
  private emitting = false;
  private revision = 0;

  constructor(private readonly ports: PromptInputPorts) {}

  onUserInput() {
    if (!this.emitting) this.revision += 1;
  }

  onData(data: string) {
    const sessionId = this.ports.session();
    if (!sessionId) return;
    this.lastWrite = this.tail.then(() => {
      if (this.ports.session() !== sessionId) throw new Error("终端会话已变更，已取消输入");
      return this.ports.write(sessionId, data);
    });
    this.tail = this.lastWrite.catch((error) => {
      if (this.ports.session() !== sessionId) return;
      this.failed = true;
      this.ports.error(error);
    });
  }

  sendText(text: string): boolean {
    const sessionId = this.ports.session();
    if (!sessionId || !text || this.pending || this.failed) return false;
    this.pending = true;
    const revision = this.revision;
    void this.submit(text, sessionId, revision).finally(() => { this.pending = false; });
    return true;
  }

  private emit(action: () => void) {
    this.emitting = true;
    try { action(); } finally { this.emitting = false; }
  }

  private async submit(text: string, sessionId: string, revision: number) {
    try {
      this.emit(() => this.ports.paste(text));
      await this.lastWrite;
      await new Promise<void>((resolve) => setTimeout(resolve, PASTE_SETTLE_MS));
      if (this.ports.session() !== sessionId || this.failed) return;
      // 用户在等待窗口输入或手动回车后，不再自动提交，以免提交两次或混入其他输入。
      if (this.revision !== revision) return;
      this.emit(() => this.ports.enter());
      await this.lastWrite;
    } catch (error) {
      // write 的失败已由队列报告；paste/input 同步异常也必须可见。
      if (!this.failed && this.ports.session() === sessionId) {
        this.failed = true;
        this.ports.error(error);
      }
    }
  }
}
