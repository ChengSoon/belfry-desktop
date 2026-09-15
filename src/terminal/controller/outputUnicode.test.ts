import { afterEach, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { CodexThemeSync } from "../codexThemeSync";
import { configureUnicode } from "../unicode";
import { TerminalOutput } from "./output";

const encoder = new TextEncoder();
const fixtures: { renderer: TerminalOutput; terminal: Terminal }[] = [];
const SAMPLE = "状态：怀念𠀁😀中文";

function fixture() {
  const terminal = new Terminal({ cols: 120, rows: 4, allowProposedApi: true });
  configureUnicode(terminal);
  const onOutput = vi.fn();
  const renderer = new TerminalOutput({ terminal,
    themeSync: new CodexThemeSync({ foreground: "#ffffff", background: "#000000" }, true),
    onOutput, onPasswordPrompt() {}, onGap() {}, onExit() {}, onAgentState() {},
  });
  let sequence = 0;
  const test = { terminal, renderer, onOutput,
    write: (bytes: Uint8Array, eof = false) => renderer.render([
      { kind: "output", sessionId: "unicode", sequence: sequence++, bytes: Array.from(bytes), eof },
    ]),
    text: () => Array.from({ length: terminal.buffer.active.length }, (_, row) =>
      terminal.buffer.active.getLine(row)?.translateToString(true) ?? "").join("\n").trim(),
  };
  fixtures.push(test);
  return test;
}

afterEach(() => {
  for (const test of fixtures.splice(0)) { test.renderer.dispose(); test.terminal.dispose(); }
});

it("preserves Chinese and supplementary characters at every two-chunk UTF-8 boundary", async () => {
  const bytes = encoder.encode(SAMPLE);
  for (let split = 1; split < bytes.length; split += 1) {
    const test = fixture();
    await test.write(bytes.slice(0, split));
    await test.write(bytes.slice(split), true);
    expect(test.text(), `UTF-8 split at byte ${split}`).toBe(SAMPLE);
    expect(test.onOutput.mock.calls.flat().join("")).toBe(SAMPLE);
  }
});

it("preserves single-byte Chinese output around Codex SGR rewriting", async () => {
  const test = fixture();
  const bytes = encoder.encode(`\x1b[48;2;39;39;40m${SAMPLE}\x1b[0m`);
  for (const byte of bytes) await test.write(Uint8Array.of(byte));
  await test.write(new Uint8Array(), true);
  expect(test.text()).toBe(SAMPLE);
  expect(test.onOutput.mock.calls.flat().join("")).toBe(`\x1b[49m${SAMPLE}\x1b[0m`);
});

it("drops an incomplete character at a replay gap without emitting orphan continuation replacements", async () => {
  const test = fixture();
  await test.write(encoder.encode("旧状态").slice(0, -1));
  await test.renderer.render([
    { kind: "replay_gap", sessionId: "unicode", nextSequence: 10, droppedEvents: 9 },
  ]);
  test.onOutput.mockClear();
  await test.write(Uint8Array.of(0x80));
  await test.write(new Uint8Array());
  await test.write(Uint8Array.of(0x81, ...encoder.encode("新状态")), true);
  expect(test.onOutput.mock.calls.flat().join("")).toBe("新状态");
  expect(test.text()).toContain("较早输出已超出后台缓存");
  expect(test.text()).toMatch(/新状态$/);
});
