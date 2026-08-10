import { describe, expect, it } from "vitest";
import { ACTIVITY_TAIL_LINES, detectActivity, screenTail, type ScreenLine } from "./activity";

/** 屏幕行的常见形态：整屏都没有软换行。 */
function screen(...text: string[]): ScreenLine[] {
  return text.map((line) => ({ text: line, isWrapped: false }));
}

function tailOf(...text: string[]) {
  return screenTail(screen(...text), ACTIVITY_TAIL_LINES);
}

describe("screenTail", () => {
  it("stitches wrapped rows back into one line", () => {
    const wrapped: ScreenLine[] = [
      { text: "✻ Thinking… (esc to ", isWrapped: false },
      { text: "interrupt)", isWrapped: true },
    ];
    // 拼接必须无缝：插一个换行就把锚点劈开了，侧栏一拖宽状态点就消失。
    expect(screenTail(wrapped, ACTIVITY_TAIL_LINES)).toBe("✻ Thinking… (esc to interrupt)");
    expect(detectActivity(screenTail(wrapped, ACTIVITY_TAIL_LINES))).toBe("talking");
  });

  it("counts up from the last non-empty row, not from the bottom of the screen", () => {
    // 刚 /clear 完是这个形态：内容在顶上，底下全是空行。
    const sparse = screen("✻ Thinking… (esc to interrupt)", "", "", "", "", "", "", "", "", "", "", "", "", "");
    expect(detectActivity(screenTail(sparse, ACTIVITY_TAIL_LINES))).toBe("talking");
  });

  it("keeps only the trailing window", () => {
    const long = screen(...Array.from({ length: 40 }, (_, i) => `line ${i}`));
    expect(screenTail(long, ACTIVITY_TAIL_LINES).split("\n")).toHaveLength(ACTIVITY_TAIL_LINES);
  });
});

describe("detectActivity", () => {
  it("reads the interrupt hint that both agents print while generating", () => {
    expect(detectActivity("✻ Cogitating… (23s · ↑ 1.2k tokens · esc to interrupt)")).toBe("talking");
    expect(detectActivity("▌ Working (Esc to interrupt)")).toBe("talking");
  });

  it("reads a permission prompt as awaiting-choice", () => {
    const prompt = tailOf(
      "│ Bash command                        │",
      "│ rm -rf tmp/*.png                    │",
      "│                                     │",
      "│ Do you want to proceed?             │",
      "│ ❯ 1. Yes                            │",
      "│   2. No, and tell Claude what to do │",
    );
    expect(detectActivity(prompt)).toBe("awaiting-choice");
  });

  it("reads a selection cursor even without the question line", () => {
    expect(detectActivity(tailOf("Pick a model", "❯ 1. Opus", "  2. Sonnet"))).toBe("awaiting-choice");
  });

  it("does not mistake a markdown ordered list for a prompt", () => {
    // 这是最大的误报源：Agent 回答收尾常是有序列表，正好落在扫描窗口里。
    const answer = tailOf(
      "改法有三步：",
      "1. 先把纯函数抽出来",
      "2. 再接适配层",
      "3. 最后画 UI",
      "",
      "需要我直接动手吗？",
    );
    expect(detectActivity(answer)).toBe("idle");
  });

  it("needs a second option before trusting a cursor line", () => {
    // 引用块 `> 1. xxx` 单独出现不算——必须还有别的选项行陪着。
    expect(detectActivity(tailOf("> 1. 引用里的第一条", "别的正文"))).toBe("idle");
  });

  it("only trusts a y/n confirm when it is the line still waiting for input", () => {
    expect(detectActivity(tailOf("Continue? (y/n) "))).toBe("awaiting-choice");
    // 说明文字里的 (y/N) 后面还跟着别的行，不是在等你按键。
    expect(detectActivity(tailOf("--force (y/N) skips the check", "$ "))).toBe("idle");
  });

  it("ignores an interrupt hint that has scrolled out of the window", () => {
    const scrolled = screen(
      "esc to interrupt",
      ...Array.from({ length: 30 }, (_, i) => `output ${i}`),
    );
    expect(detectActivity(screenTail(scrolled, ACTIVITY_TAIL_LINES))).toBe("idle");
  });

  it("falls back to idle on anything it cannot place", () => {
    expect(detectActivity("")).toBe("idle");
    expect(detectActivity("$ ")).toBe("idle");
    expect(detectActivity(tailOf("~/work/otty-win on  main", "❯ "))).toBe("idle");
  });
});
