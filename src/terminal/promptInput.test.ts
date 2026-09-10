import { afterEach, describe, expect, it, vi } from "vitest";
import { PASTE_SETTLE_MS, PromptInput } from "./promptInput";

function setup() {
  let session: string | null = "old";
  const write = vi.fn(async (_id: string, _data: string) => {});
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
