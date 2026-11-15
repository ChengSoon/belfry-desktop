import type { IFunctionIdentifier, IParser } from "@xterm/xterm";

/** Identify parser replies and passive pointer reports at their source, before onData mixes them with input. */
export class TerminalResponses {
  private expected: RegExp | null = null;
  private pointerEvent: MouseEvent | null = null;
  private revision = 0;
  private readonly handlers: Array<{ dispose(): void }> = [];

  constructor(parser?: IParser, host?: Pick<HTMLElement, "addEventListener" | "removeEventListener">) {
    if (host) {
      const motion = (event: MouseEvent) => {
        if (event.buttons !== 0) { this.clear(); return; }
        const code = 35 | (event.shiftKey ? 4 : 0) | (event.altKey ? 8 : 0) | (event.ctrlKey ? 16 : 0);
        // Only the synchronous report from a buttonless DOM move is passive. Clicks,
        // drags, wheel events and a pasted lookalike retain ordinary input ownership.
        this.expect(new RegExp(`^\\x1b\\[<${code};\\d{1,6};\\d{1,6}M$`), event);
      };
      host.addEventListener("mousemove", motion, { capture: true });
      this.handlers.push({ dispose: () => host.removeEventListener("mousemove", motion, { capture: true }) });
    }
    if (!parser) return;
    const csi = (id: IFunctionIdentifier, match: (params: (number | number[])[]) => RegExp | null) => {
      this.handlers.push(parser.registerCsiHandler(id, params => {
        const reply = match(params);
        if (reply) this.expect(reply);
        // Keep xterm's built-in handler, including its actual cursor and terminal settings.
        return false;
      }));
    };
    for (const prefix of ["", "?"]) {
      csi({ prefix, final: "n" }, params => {
        if (params.length !== 1) return null;
        if (params[0] === 6) return prefix ? /^\x1b\[\?\d+;\d+R$/ : /^\x1b\[\d+;\d+R$/;
        if (params[0] === 5) return prefix ? /^\x1b\[\?0n$/ : /^\x1b\[0n$/;
        return null;
      });
    }
    for (const prefix of ["", ">"]) {
      csi({ prefix, final: "c" }, params => params.length === 1 && params[0] === 0
        ? prefix ? /^\x1b\[>\d+(?:;\d+)*c$/ : /^\x1b\[\?\d+(?:;\d+)*c$/ : null);
    }
    csi({ prefix: "?", intermediates: "$", final: "p" }, params => params.length === 1 && typeof params[0] === "number"
      ? new RegExp(`^\\x1b\\[\\?${params[0]};[0-4]\\$y$`) : null);
    csi({ final: "t" }, params => params.length === 1 && [14, 16, 18, 19].includes(params[0] as number)
      ? /^\x1b\[\d+;\d+;\d+t$/ : null);
  }

  consume(data: string) {
    if (this.pointerEvent?.eventPhase === 0) { this.clear(); return false; }
    if (!this.expected?.test(data)) return false;
    this.clear();
    return true;
  }

  /** Public keyboard, paste and IME events can never borrow a parser reply marker. */
  userInput() { this.clear(); }

  dispose() {
    this.clear();
    this.handlers.splice(0).forEach(handler => handler.dispose());
  }

  private clear() { this.revision += 1; this.expected = null; this.pointerEvent = null; }

  private expect(reply: RegExp, pointerEvent: MouseEvent | null = null) {
    this.expected = reply;
    this.pointerEvent = pointerEvent;
    const revision = ++this.revision;
    // Browsers may run microtasks between DOM capture and xterm's listener. The
    // pointer marker instead expires when that exact event finishes dispatching.
    if (pointerEvent) return;
    // Parser replies are synchronous within xterm's parsing call.
    queueMicrotask(() => { if (this.revision === revision) this.clear(); });
  }
}
