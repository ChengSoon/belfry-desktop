import { expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { CodexThemeSync } from "../codexThemeSync";
import { TerminalOutput } from "./output";
import { OutputQueue, OUTPUT_WINDOW_BYTES } from "./outputQueue";

const CHUNK_BYTES = 64 * 1024;
const CHUNKS = 1024;
const EVENT_COST = CHUNK_BYTES + 128;

/** 真实 xterm 解析器，不创建窗口；宿主模拟器严格按相同源字节预算发送。 */
it("parses 64 MiB through a bounded queue and keeps the input path available", async () => {
  const terminal = new Terminal({ cols: 80, rows: 24 });
  const bytes = Array<number>(CHUNK_BYTES).fill(120);
  let sent = 0, acknowledged = 0, inFlight = 0, peakInFlight = 0;
  let parsing = 0, peakParsing = 0, decoded = 0, inputs = 0;
  let finish!: () => void, fail!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  const input = terminal.onData(() => { inputs += 1; });
  const renderer = new TerminalOutput({
    terminal: { reset: () => terminal.reset(), write: (data, parsed) => {
      parsing += data.length;
      peakParsing = Math.max(peakParsing, parsing);
      terminal.write(data, () => { parsing -= data.length; parsed?.(); });
    } },
    themeSync: new CodexThemeSync({ foreground: "#ffffff", background: "#000000" }, false, false),
    onOutput: (text) => { decoded += text.length; }, onPasswordPrompt() {}, onGap() { fail(new Error("unexpected gap")); },
    onExit() {}, onAgentState() {},
  });
  const queue = new OutputQueue({ render: (events) => renderer.render(events), fail,
    acknowledge: async (receipt) => {
      expect(receipt.deliveryId).toBe(acknowledged + 1);
      acknowledged += 1;
      inFlight -= EVENT_COST;
      produce();
      if (acknowledged === CHUNKS) finish();
      return true;
    },
  });
  function produce() {
    while (sent < CHUNKS && inFlight + EVENT_COST <= OUTPUT_WINDOW_BYTES) {
      inFlight += EVENT_COST;
      peakInFlight = Math.max(peakInFlight, inFlight);
      const sequence = sent++;
      queue.push({ kind: "output_batch", sessionId: "stress", connectionId: "stress-connection", deliveryId: sequence + 1,
        events: [{ kind: "output", sessionId: "stress", sequence, bytes, eof: sequence === CHUNKS - 1 }] });
    }
  }
  const started = performance.now();
  try {
    produce();
    expect(inFlight).toBeGreaterThan(0);
    terminal.input("input during pending output", true);
    expect(inputs).toBe(1);
    await done;
    expect(decoded).toBe(CHUNK_BYTES * CHUNKS);
    expect(acknowledged).toBe(CHUNKS);
    expect(peakInFlight).toBeLessThanOrEqual(OUTPUT_WINDOW_BYTES);
    expect(peakParsing).toBe(CHUNK_BYTES);
    expect(parsing).toBe(0);
    console.info(`terminal xterm stress: parsed=64 MiB, source_peak=${peakInFlight}, parser_peak=${peakParsing}, acks=${acknowledged}, elapsed_ms=${Math.round(performance.now() - started)}`);
  } finally {
    queue.dispose(); renderer.dispose(); input.dispose(); terminal.dispose();
  }
}, 30_000);
