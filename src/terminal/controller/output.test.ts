import { describe, expect, it, vi } from "vitest";
import { CodexThemeSync } from "../codexThemeSync";
import type { TerminalStreamEvent } from "../contracts";
import { TerminalOutput } from "./output";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
function output(sequence: number, bytes: number[]): TerminalStreamEvent {
  return { kind: "output", sessionId: "pty", sequence, bytes, eof: false };
}
function fixture(transparent = false) {
  const writes: { bytes: Uint8Array; parsed: () => void }[] = [];
  const terminal = { reset: vi.fn(), write: vi.fn((bytes: string | Uint8Array, parsed?: () => void) => {
    writes.push({ bytes: typeof bytes === "string" ? encoder.encode(bytes) : bytes, parsed: parsed! });
  }) };
  const onOutput = vi.fn();
  const onExit = vi.fn();
  const onGap = vi.fn();
  const renderer = new TerminalOutput({ terminal, themeSync: new CodexThemeSync({ foreground: "#ffffff", background: "#000000" }, transparent, false),
    onOutput, onExit, onGap, onPasswordPrompt: vi.fn(), onAgentState: vi.fn() });
  return { renderer, terminal, writes, onOutput, onExit, onGap };
}

describe("terminal output rendering", () => {
  it("coalesces consecutive small frames without breaking UTF-8 or ANSI across chunks", async () => {
    const test = fixture();
    const first = [0xe4];
    const second = [0xbd, 0xa0, ...encoder.encode("\x1b[3")];
    const third = [...encoder.encode("1mred\x1b[0m")];
    const rendered = test.renderer.render([output(0, first), output(1, second), output(2, third)]);
    expect(test.terminal.write).toHaveBeenCalledOnce();
    expect(decoder.decode(test.writes[0].bytes)).toBe("你\x1b[31mred\x1b[0m");
    expect(test.onOutput.mock.calls.flat().join("")).toBe("你\x1b[31mred\x1b[0m");
    test.writes[0].parsed();
    await rendered;
  });

  it("waits for the parser even when the theme filter retains an entire ANSI fragment", async () => {
    const test = fixture(true);
    let consumed = false;
    const rendered = test.renderer.render([output(0, [...encoder.encode("\x1b[")])]).then(() => { consumed = true; });
    await Promise.resolve();
    expect(consumed).toBe(false);
    expect(test.writes[0].bytes).toHaveLength(0);
    test.writes[0].parsed();
    await rendered;
    expect(consumed).toBe(true);
  });

  it("drains earlier writes before resetting on gap, shows the gap and continues at its sequence", async () => {
    const test = fixture();
    const rendered = test.renderer.render([
      output(0, [...encoder.encode("before")]),
      { kind: "replay_gap", sessionId: "pty", nextSequence: 99, droppedEvents: 98 },
      output(99, [...encoder.encode("after")]),
    ]);
    expect(test.terminal.reset).not.toHaveBeenCalled();
    test.writes[0].parsed();
    await vi.waitFor(() => expect(test.writes).toHaveLength(2));
    expect(test.terminal.reset).toHaveBeenCalledOnce();
    expect(decoder.decode(test.writes[1].bytes)).toContain("较早输出已超出后台缓存");
    test.writes[1].parsed();
    await vi.waitFor(() => expect(test.writes).toHaveLength(3));
    expect(decoder.decode(test.writes[2].bytes)).toBe("after");
    test.writes[2].parsed();
    await rendered;
    expect(test.onGap).toHaveBeenCalledOnce();
  });

  it("keeps the final output before exit and reports diagnostics after the exit notice is parsed", async () => {
    const test = fixture();
    const rendered = test.renderer.render([output(0, [...encoder.encode("Error: failed")]),
      { kind: "exit", sessionId: "pty", exitCode: 1, reason: "normal" }]);
    expect(test.onExit).not.toHaveBeenCalled();
    test.writes[0].parsed();
    await vi.waitFor(() => expect(test.writes).toHaveLength(2));
    expect(decoder.decode(test.writes[1].bytes)).toContain("process exited 1");
    test.writes[1].parsed();
    await rendered;
    expect(test.onExit).toHaveBeenCalledWith(1, "Error: failed");
  });

  it("disposal releases a parser waiter and suppresses later control events", async () => {
    const test = fixture();
    const rendered = test.renderer.render([output(0, [120]),
      { kind: "exit", sessionId: "pty", exitCode: 0, reason: "normal" }]);
    test.renderer.dispose();
    await rendered;
    expect(test.onExit).not.toHaveBeenCalled();
    expect(test.terminal.write).toHaveBeenCalledOnce();
  });
});
