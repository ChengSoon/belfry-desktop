import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptDeliveryOptions, TerminalCommandTarget } from "../terminal/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import { pasteSettleMs, PromptInput, WINDOWS_PASTE_SETTLE_MS } from "../terminal/promptInput";
import { PROMPT_CONFIRM_TIMEOUT_MS, PromptQueueRuntime } from "./runtime";

const idle = { id: "agent", kind: "codex", phase: "running", activity: "idle" } as WorkspaceTab;
const busy = { ...idle, activity: "talking" } as WorkspaceTab;

function fixture(bracketed = true) {
  const runtime = new PromptQueueRuntime();
  const write = vi.fn(async (_id: string, _data: string) => {});
  const notifyInputIssue = vi.fn();
  const input = new PromptInput({
    session: () => "pty",
    paste: (text) => {
      const normalized = text.replace(/\r?\n/gu, "\r"); // xterm Clipboard.prepareTextForTerminal
      input.onData(bracketed ? `\x1b[200~${normalized}\x1b[201~` : normalized);
    },
    enter: () => input.onData("\r"),
    write, error: vi.fn(), settleMs: pasteSettleMs("Windows NT 10.0"),
  });
  const target: TerminalCommandTarget = { focus: vi.fn(), sendText: (text, options) => input.sendText(text, options), notifyInputIssue, getSessionId: () => "pty" };
  const targets = new Map([[idle.id, target]]);
  return { runtime, input, write, target, targets, notifyInputIssue,
    send: (text: string) => runtime.submit([idle], targets, idle.id, text),
    sync: (tab = idle) => runtime.sync([tab], targets) };
}

afterEach(() => vi.useRealTimers());

describe("collaboration prompt delivery", () => {
  it.each([true, false])("Windows paste mode %s waits for the parser and writes Enter exactly once", async (bracketed) => {
    vi.useFakeTimers();
    const test = fixture(bracketed);
    expect(test.send("first\nsecond")).toBe("sent");
    await vi.advanceTimersByTimeAsync(WINDOWS_PASTE_SETTLE_MS - 1);
    expect(test.write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(test.write.mock.calls.map((call) => call[1])).toEqual([
      bracketed ? "\x1b[200~first\rsecond\x1b[201~" : "first\rsecond", "\r",
    ]);
    test.sync(busy);
    test.send("next");
    test.sync();
    await vi.advanceTimersByTimeAsync(WINDOWS_PASTE_SETTLE_MS);
    expect(test.write).toHaveBeenCalledTimes(4);
    expect(test.target.focus).not.toHaveBeenCalled();
  });

  it("user cancellation is visible, never repastes partial text, and resumes after manual submission", async () => {
    vi.useFakeTimers();
    const test = fixture();
    test.send("first"); test.send("second");
    await vi.advanceTimersByTimeAsync(0);
    test.input.onUserInput();
    await vi.advanceTimersByTimeAsync(WINDOWS_PASTE_SETTLE_MS);
    test.sync();
    expect(test.notifyInputIssue).toHaveBeenCalledOnce();
    expect(test.notifyInputIssue).toHaveBeenCalledWith(expect.stringContaining("中断"));
    expect(test.write).toHaveBeenCalledTimes(1);
    expect(test.runtime.items.map((item) => item.text)).toEqual(["second"]);
    test.input.onUserInput(); test.input.onData("\r");
    await vi.advanceTimersByTimeAsync(0);
    test.sync(busy); test.sync();
    await vi.advanceTimersByTimeAsync(WINDOWS_PASTE_SETTLE_MS);
    expect(test.write.mock.calls.map((call) => call[1])).toEqual([
      "\x1b[200~first\x1b[201~", "\r", "\x1b[200~second\x1b[201~", "\r",
    ]);
  });

  it.each([1, 2])("write failure at step %s releases in-flight state but does not send the next task into partial input", async (step) => {
    vi.useFakeTimers();
    const test = fixture();
    if (step === 2) test.write.mockResolvedValueOnce(undefined);
    test.write.mockRejectedValueOnce(new Error("ConPTY write failed"));
    test.send("first"); test.send("second");
    await vi.advanceTimersByTimeAsync(WINDOWS_PASTE_SETTLE_MS);
    test.sync();
    expect(test.notifyInputIssue).toHaveBeenCalledWith(expect.stringContaining("写入失败"));
    expect(test.write).toHaveBeenCalledTimes(step);
    // A genuinely new PTY is safe; a new front-end target alone is not.
    const recovered: TerminalCommandTarget = { focus: vi.fn(), sendText: vi.fn(() => true), getSessionId: () => "new-pty" };
    test.runtime.sync([idle], new Map([[idle.id, recovered]]));
    expect(recovered.sendText).toHaveBeenCalledExactlyOnceWith("second", expect.any(Object));
  });

  it("unconfirmed submissions show one warning, without repeating Enter or blocking forever silently", async () => {
    vi.useFakeTimers();
    const test = fixture();
    test.send("first"); test.send("second");
    await vi.advanceTimersByTimeAsync(PROMPT_CONFIRM_TIMEOUT_MS);
    test.sync(); test.sync();
    expect(test.notifyInputIssue).toHaveBeenCalledOnce();
    expect(test.notifyInputIssue).toHaveBeenCalledWith(expect.stringContaining("尚未确认"));
    expect(test.write).toHaveBeenCalledTimes(2);
    test.sync(busy); test.sync();
    await vi.advanceTimersByTimeAsync(WINDOWS_PASTE_SETTLE_MS);
    expect(test.write).toHaveBeenCalledTimes(4);
  });

  it("does not replay a prompt whose Enter was already written when the terminal remounts", async () => {
    vi.useFakeTimers();
    const test = fixture();
    test.send("first");
    await vi.advanceTimersByTimeAsync(WINDOWS_PASTE_SETTLE_MS);
    const next: TerminalCommandTarget = { focus: vi.fn(), sendText: vi.fn(() => true) };
    test.runtime.sync([idle], new Map([[idle.id, next]]));
    expect(next.sendText).not.toHaveBeenCalled();
    expect(test.runtime.items).toEqual([]);
  });

  it("ignores results from an old target after a queued prompt moved to a new target", () => {
    const runtime = new PromptQueueRuntime();
    let firstOptions: PromptDeliveryOptions | undefined;
    const first: TerminalCommandTarget = { focus: vi.fn(), sendText: (_text, options) => { firstOptions = options; return true; }, notifyInputIssue: vi.fn() };
    const next: TerminalCommandTarget = { focus: vi.fn(), sendText: vi.fn(() => true) };
    runtime.submit([idle], new Map([[idle.id, first]]), idle.id, "task");
    firstOptions?.onResult?.("not-written");
    runtime.sync([idle], new Map([[idle.id, next]]));
    firstOptions?.onResult?.("failed");
    expect(first.notifyInputIssue).not.toHaveBeenCalled();
    runtime.sync([busy], new Map([[idle.id, next]]));
    runtime.submit([idle], new Map([[idle.id, next]]), idle.id, "next");
    expect(next.sendText).toHaveBeenCalledTimes(2);
  });

  it("does not clear a cancellation pause when reconnecting to the same PTY", async () => {
    vi.useFakeTimers();
    const test = fixture();
    test.send("first"); test.send("second");
    await vi.advanceTimersByTimeAsync(0);
    test.input.onUserInput();
    await vi.advanceTimersByTimeAsync(WINDOWS_PASTE_SETTLE_MS);
    const same: TerminalCommandTarget = { focus: vi.fn(), sendText: vi.fn(() => true), getSessionId: () => "pty", notifyInputIssue: vi.fn() };
    const targets = new Map([[idle.id, same]]);
    test.runtime.sync([idle], targets);
    test.runtime.sync([idle], targets);
    expect(same.sendText).not.toHaveBeenCalled();
    expect(same.notifyInputIssue).toHaveBeenCalledOnce();
    test.runtime.sync([busy], targets); // 用户确认残留输入。
    test.runtime.sync([idle], targets);
    expect(same.sendText).toHaveBeenCalledExactlyOnceWith("second", expect.any(Object));
  });

  it("does not repaste a task after successful paste followed by disconnection before Enter", async () => {
    vi.useFakeTimers();
    const test = fixture();
    test.send("first"); test.send("second");
    await vi.advanceTimersByTimeAsync(0);
    test.input.dispose();
    await vi.runAllTimersAsync();
    const same: TerminalCommandTarget = { focus: vi.fn(), sendText: vi.fn(() => true), getSessionId: () => "pty" };
    test.runtime.sync([idle], new Map([[idle.id, same]]));
    expect(same.sendText).not.toHaveBeenCalled();
    expect(test.write).toHaveBeenCalledTimes(1);
    expect(test.runtime.items.map((item) => item.text)).toEqual(["second"]);
    expect(test.notifyInputIssue).toHaveBeenCalledWith(expect.stringContaining("连接中断"));
  });

  it("requeues a task only when disposal prevented any actual write attempt", async () => {
    vi.useFakeTimers();
    const test = fixture();
    test.send("first");
    test.input.dispose();
    await vi.runAllTimersAsync();
    expect(test.write).not.toHaveBeenCalled();
    const same: TerminalCommandTarget = { focus: vi.fn(), sendText: vi.fn(() => true), getSessionId: () => "pty" };
    test.runtime.sync([idle], new Map([[idle.id, same]]));
    expect(same.sendText).toHaveBeenCalledExactlyOnceWith("first", expect.any(Object));
  });
});
