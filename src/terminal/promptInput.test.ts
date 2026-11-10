import { afterEach, describe, expect, it, vi } from "vitest";
import { PASTE_SETTLE_MS, PromptInput } from "./promptInput";

function setup() {
  let session: string | null = "old";
  const write = vi.fn(async (_id: string, _data: string, _guarded?: { guard: { token: string }; sequence: number }) => {});
  const error = vi.fn();
  const input = new PromptInput({
    session: () => session,
    paste: (text) => input.onData(`\x1b[200~${text}\x1b[201~`),
    enter: () => input.onData("\r"),
    write,
    error,
  });
  return { input, write, error, replace: (id: string | null) => { session = id; } };
}

afterEach(() => vi.useRealTimers());

describe("PromptInput", () => {
  it("dispose 立即清除解析窗口计时器且不再自动回车", async () => {
    vi.useFakeTimers();
    const { input, write } = setup();
    input.sendText("task");
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    input.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(write).toHaveBeenCalledTimes(1);
    expect(input.sendText("late")).toBe(false);
  });

  it("dispose 之后迟到的粘贴写入完成不会新建计时器", async () => {
    vi.useFakeTimers();
    const { input, write } = setup();
    let finish!: () => void;
    write.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    input.sendText("task");
    await vi.advanceTimersByTimeAsync(0);
    input.dispose();
    finish();
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("等待实际粘贴写入完成，再经过解析窗口只提交一次", async () => {
    vi.useFakeTimers();
    const { input, write } = setup();
    let finish!: () => void;
    write.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    expect(input.sendText("first\nsecond")).toBe(true);
    expect(input.sendText("duplicate")).toBe(false);
    await vi.advanceTimersByTimeAsync(PASTE_SETTLE_MS * 2);
    expect(write).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(PASTE_SETTLE_MS - 1);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(write.mock.calls).toEqual([
      ["old", "\x1b[200~first\nsecond\x1b[201~"], ["old", "\r"],
    ]);
    await vi.advanceTimersByTimeAsync(PASTE_SETTLE_MS * 2);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it.each([null, "new"])("等待时会话变为 %s，不向旧会话或重启会话发回车", async (next) => {
    vi.useFakeTimers();
    const { input, write, replace } = setup();
    input.sendText("task");
    await vi.advanceTimersByTimeAsync(0);
    replace(next);
    await vi.advanceTimersByTimeAsync(PASTE_SETTLE_MS);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("排队写入执行前退出时，连粘贴也不写入", async () => {
    vi.useFakeTimers();
    const { input, write, replace } = setup();
    input.sendText("task");
    replace(null);
    await vi.runAllTimersAsync();
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["\r", "typed"])("等待时用户输入 %j，取消自动回车", async (data) => {
    vi.useFakeTimers();
    const { input, write } = setup();
    input.sendText("task");
    await vi.advanceTimersByTimeAsync(0);
    input.onUserInput();
    input.onData(data);
    await vi.advanceTimersByTimeAsync(PASTE_SETTLE_MS);
    expect(write.mock.calls.map((call) => call[1])).toEqual(["\x1b[200~task\x1b[201~", data]);
  });

  it("粘贴写失败可见、不回车、不自动重试，仍允许人工输入", async () => {
    vi.useFakeTimers();
    const { input, write, error } = setup();
    write.mockRejectedValueOnce(new Error("write failed"));
    input.sendText("task");
    await vi.runAllTimersAsync();
    expect(error).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(input.sendText("retry")).toBe(false);
    input.onData("manual");
    await vi.runAllTimersAsync();
    expect(write).toHaveBeenLastCalledWith("old", "manual");
  });

  it("Enter 写失败只报告一次，不补发不重贴", async () => {
    vi.useFakeTimers();
    const { input, write, error } = setup();
    write.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("enter failed"));
    input.sendText("task");
    await vi.runAllTimersAsync();
    expect(error).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(input.sendText("task")).toBe(false);
  });
});

 it.each(["\x1b[1;1R", "\x1b[?1;2c", "\x1b]10;rgb:ffff/ffff/ffff\x1b\\"])("设备应答 %j 不取消自动提交", async (response) => {
   vi.useFakeTimers();
   const { input, write } = setup();
   input.sendText("task");
   await vi.advanceTimersByTimeAsync(0);
   input.onData(response);
   await vi.advanceTimersByTimeAsync(PASTE_SETTLE_MS);
   expect(write.mock.calls.map((call) => call[1])).toEqual(["\x1b[200~task\x1b[201~", response, "\r"]);
 });

describe("PromptInput 收件箱 guard", () => {
  const guard = { batchId: "b", attemptId: "a", token: "tok", ownerId: "o", targetEpoch: "e", inputRevision: 0 };

  it("本批的粘贴与回车都带同一 guard，writeSequence 从 1 连续递增", async () => {
    vi.useFakeTimers();
    const { input, write } = setup();
    const results: string[] = [];
    expect(input.sendText("batch", { inboxGuard: guard, onResult: (r) => results.push(r) })).toBe(true);
    await vi.runAllTimersAsync();
    expect(results).toEqual(["submitted"]);
    expect(write.mock.calls.map((c) => c[2])).toEqual([{ guard, sequence: 1 }, { guard, sequence: 2 }]);
  });

  it("用户键盘输入（即使发生在本批等待期间）不带 guard，且使本批取消回车", async () => {
    vi.useFakeTimers();
    const { input, write } = setup();
    const results: string[] = [];
    input.sendText("batch", { inboxGuard: guard, onResult: (r) => results.push(r) });
    await vi.advanceTimersByTimeAsync(0);
    input.onUserInput();
    input.onData("x");
    await vi.runAllTimersAsync();
    expect(results).toEqual(["cancelled"]);
    expect(write.mock.calls.map((c) => c[2])).toEqual([{ guard, sequence: 1 }, undefined]);
  });

  it("不带 guard 的普通 sendText 不传 guard 参数", async () => {
    vi.useFakeTimers();
    const { input, write } = setup();
    input.sendText("plain");
    await vi.runAllTimersAsync();
    expect(write.mock.calls.every((c) => c.length === 2)).toBe(true);
  });

  it("输入代次已被用户推进时拒绝写入（未写任何字节）", () => {
    const { input, write } = setup();
    const before = input.inputRevision;
    input.onUserInput();
    expect(input.sendText("batch", { inboxGuard: guard, expectedInputRevision: before })).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});
