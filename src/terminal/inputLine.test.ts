import { describe, expect, it } from "vitest";
import { emptyInputLine, feedInputLine, muteInputLine } from "./inputLine";

/** 连续喂入多段数据，返回全部提交行——真实按键是一个字符一个 onData。 */
function typeAll(chunks: string[]) {
  let state = emptyInputLine();
  const submitted: string[] = [];
  for (const chunk of chunks) {
    const fed = feedInputLine(state, chunk);
    state = fed.state;
    submitted.push(...fed.submitted);
  }
  return { state, submitted };
}

describe("input line assembly", () => {
  it("submits a line on enter", () => {
    expect(typeAll([..."pnpm dev", "\r"]).submitted).toEqual(["pnpm dev"]);
  });

  it("keeps buffering until enter arrives", () => {
    const { state, submitted } = typeAll([..."git st"]);
    expect(submitted).toEqual([]);
    expect(state.buffer).toBe("git st");
  });

  it("applies backspace, ctrl+u and ctrl+w", () => {
    expect(typeAll(["abc", "\x7f", "\r"]).submitted).toEqual(["ab"]);
    expect(typeAll(["abc", "\x15", "xyz", "\r"]).submitted).toEqual(["xyz"]);
    expect(typeAll(["git commit amend", "\x17", "\r"]).submitted).toEqual(["git commit"]);
  });

  it("drops a cancelled line on ctrl+c", () => {
    expect(typeAll(["rm -rf /", "\x03", "ls", "\r"]).submitted).toEqual(["ls"]);
  });

  it("lifts the mute when the password prompt is cancelled", () => {
    // 密码提示按 Ctrl+C/Ctrl+D 取消后不解除静默，之后的正常命令会被一直吞掉。
    for (const cancel of ["\x03", "\x04"]) {
      const cancelled = feedInputLine(muteInputLine(emptyInputLine()), cancel);
      expect(cancelled.state.muted).toBe(false);
      expect(feedInputLine(cancelled.state, "git log\r").submitted).toEqual(["git log"]);
    }
  });

  it("keeps the mute when the password is only cleared with ctrl+u", () => {
    // Ctrl+U 是重输密码，还在等同一个密码，不能解除静默。
    const cleared = feedInputLine(muteInputLine(emptyInputLine()), "\x15");
    expect(cleared.state.muted).toBe(true);
  });

  it("swallows escape sequences instead of typing their parameter bytes", () => {
    // 方向键的 [ 和 D 都是可打印字符，漏进缓冲区就变成标题里的乱码。
    expect(typeAll(["ab", "\x1b[D", "\x1b[1;5C", "\x1bOA", "c", "\r"]).submitted).toEqual(["abc"]);
  });

  it("joins a bracketed paste into one submission", () => {
    const pasted = "\x1b[200~第一行\n第二行\n\x1b[201~";
    expect(typeAll([pasted, "\r"]).submitted).toEqual(["第一行 第二行 "]);
  });

  it("treats an unbracketed multi-line paste as separate submissions", () => {
    // 没开 bracketed paste 时 shell 会逐行执行，如实还原成多次提交。
    expect(typeAll(["pnpm i\npnpm dev\n"]).submitted).toEqual(["pnpm i", "pnpm dev"]);
  });

  it("ignores blank submissions", () => {
    expect(typeAll(["\r", "   ", "\r"]).submitted).toEqual([]);
  });

  it("discards everything typed while muted, then recovers", () => {
    let state = muteInputLine(emptyInputLine());
    const secret = feedInputLine(state, "hunter2\r");
    expect(secret.submitted).toEqual([]);
    expect(secret.state.buffer).toBe("");
    expect(secret.state.muted).toBe(false);

    state = secret.state;
    expect(feedInputLine(state, "git log\r").submitted).toEqual(["git log"]);
  });

  it("keeps a pasted password out of the buffer while muted", () => {
    const state = muteInputLine(emptyInputLine());
    const fed = feedInputLine(state, "\x1b[200~hunter2\x1b[201~");
    expect(fed.state.buffer).toBe("");
  });
});
