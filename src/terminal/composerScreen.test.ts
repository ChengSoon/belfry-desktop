import { describe, expect, it } from "vitest";
import { observeComposer, type ObservedRow } from "./composerScreen";

function cells(text: string, dim: boolean) {
  return [...text].map((chars) => ({ chars, dim }));
}
function row(prompt: string, content: string, contentDim: boolean): ObservedRow {
  return { cells: [...cells(prompt, false), ...cells(content, contentDim)] };
}
function blank(columns = 40): ObservedRow {
  return { cells: cells(" ".repeat(columns), false) };
}

const placeholder = "Ask Codex to do anything";
const footer = row("  ", "GPT-6-Astra xhigh Fast · ~/work/project", false);

describe("codex composer observation", () => {
  it("treats the dim empty hint as an empty composer", () => {
    expect(observeComposer([blank(), row("› ", placeholder, true), blank(), footer], "codex")).toBe("empty");
  });

  it("does not trust the hint when its styling is not dim", () => {
    expect(observeComposer([row("› ", placeholder, false)], "codex")).toBe("occupied");
  });

  it("falls back to the exact hint when a background image strips dim", () => {
    // 透明背景下主题同步会删掉 SGR 2，此时提示词不再有暗色可查。
    expect(observeComposer([row("› ", placeholder, false)], "codex", false)).toBe("empty");
    expect(observeComposer([row("› ", "Ask Codex to do anything else", false)], "codex", false)).toBe("occupied");
  });

  it.each(["› unsent draft", "› [Pasted text #1 +3 lines]", "› [Image #1]"])(
    "keeps %s owned",
    (text) => {
      const [prompt, ...rest] = [...text];
      expect(observeComposer([row(`${prompt}${rest[0] ?? ""}`, rest.slice(1).join(""), false)], "codex")).toBe("occupied");
    },
  );

  it("cannot prove a bare prompt is empty", () => {
    // Codex hides the hint when the composer loses focus; an empty row alone
    // is not enough evidence to release a draft.
    expect(observeComposer([row("› ", "", false)], "codex")).toBe("unknown");
  });

  it("ignores an earlier prompt in the transcript", () => {
    expect(observeComposer([
      row("› ", "an already submitted message", false),
      blank(),
      row("› ", placeholder, true),
    ], "codex")).toBe("empty");
  });

  it("accepts the newer prompt glyph", () => {
    expect(observeComposer([row("» ", placeholder, true)], "codex")).toBe("empty");
  });

  it("stays unknown without a visible prompt row", () => {
    expect(observeComposer([blank(), footer], "codex")).toBe("unknown");
    expect(observeComposer([], "codex")).toBe("unknown");
  });

  it("never infers ownership for layouts that have not been verified", () => {
    expect(observeComposer([row("› ", placeholder, true)], "claude")).toBe("unknown");
    expect(observeComposer([row("› ", placeholder, true)], null)).toBe("unknown");
  });
});
