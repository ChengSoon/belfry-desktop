import type { Terminal } from "@xterm/xterm";
import type { HookSnapshot } from "../../agent/hooks/contracts";
import type { TerminalStreamEvent } from "../contracts";
import { CodexThemeSync } from "../codexThemeSync";
import { looksLikePasswordPrompt } from "../passwordPrompt";
import { Utf8Boundary } from "./utf8Boundary";

const MAX_OUTPUT_TAIL = 16_384;
const PROMPT_TAIL_BYTES = 200;
const MAX_RENDER_BYTES = 512 * 1024;
const encoder = new TextEncoder();
const tailDecoder = new TextDecoder();

interface OutputPorts {
  terminal: Pick<Terminal, "write" | "reset">;
  themeSync: CodexThemeSync;
  onOutput: (text: string) => void;
  onPasswordPrompt: () => void;
  onGap: () => void;
  onExit: (code: number, tail: string) => void;
  onAgentState: (snapshot: HookSnapshot) => void;
}

/** 输出解码/主题过滤与解析屏障。gap 的 reset 必须等此前写入完成。 */
export class TerminalOutput {
  private readonly decoder = new TextDecoder();
  private readonly utf8 = new Utf8Boundary();
  private tail = "";
  private disposed = false;
  private finishWrite: (() => void) | null = null;

  constructor(private readonly ports: OutputPorts) {}

  async render(events: TerminalStreamEvent[]) {
    let chunks: Uint8Array[] = [];
    for (const event of events) {
      if (this.disposed) return;
      if (event.kind === "output") {
        chunks.push(this.output(event));
        continue;
      }
      await this.writeChunks(chunks);
      chunks = [];
      if (this.disposed) return;
      await this.control(event);
    }
    if (!this.disposed) await this.writeChunks(chunks);
  }

  dispose() {
    this.disposed = true;
    this.finishWrite?.();
    this.ports.themeSync.flush();
    this.decoder.decode();
    this.utf8.reset();
  }

  private output(event: Extract<TerminalStreamEvent, { kind: "output" }>) {
    const filtered = new Uint8Array(this.ports.themeSync.rewrite(event.bytes, event.eof));
    const bytes = this.utf8.push(filtered, event.eof);
    this.publish(this.decoder.decode(bytes, { stream: !event.eof }));
    const tail = event.bytes.length > PROMPT_TAIL_BYTES ? event.bytes.slice(-PROMPT_TAIL_BYTES) : event.bytes;
    if (looksLikePasswordPrompt(tailDecoder.decode(new Uint8Array(tail)))) this.ports.onPasswordPrompt();
    return bytes;
  }

  private async control(event: Exclude<TerminalStreamEvent, { kind: "output" }>) {
    if (event.kind === "disconnected") throw new Error(event.message);
    if (event.kind === "agent_state") { this.ports.onAgentState(event.snapshot); return; }
    if (event.kind === "replay_gap") {
      this.decoder.decode();
      this.utf8.reset(true);
      this.tail = "";
      this.ports.themeSync.flush();
      this.ports.terminal.reset();
      this.ports.onGap();
      await this.writeChunks([encoder.encode("\r\n[较早输出已超出后台缓存，以下从仍保留的位置继续]\r\n")]);
      return;
    }
    const held = this.utf8.push(new Uint8Array(this.ports.themeSync.flush()), true);
    this.publish(this.decoder.decode(held));
    await this.writeChunks([held, encoder.encode(`\r\n\x1b[90m[process exited ${event.exitCode}]\x1b[0m\r\n`)]);
    if (!this.disposed) this.ports.onExit(event.exitCode, this.tail);
  }

  private publish(text: string) {
    if (!text) return;
    this.tail = (this.tail + text).slice(-MAX_OUTPUT_TAIL);
    this.ports.onOutput(text);
  }

  private writeChunks(chunks: Uint8Array[]) {
    if (!chunks.length) return Promise.resolve();
    const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (size > MAX_RENDER_BYTES) throw new Error("终端过滤后的输出超出渲染预算，请重新连接。");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new Promise<void>((resolve) => {
      // 空块也经解析回调确认；主题过滤可能暂存一个未结束的 ANSI 序列。
      const finish = () => { this.finishWrite = null; resolve(); };
      this.finishWrite = finish;
      this.ports.terminal.write(bytes, finish);
    });
  }
}
