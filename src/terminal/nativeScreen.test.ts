import { describe, expect, it } from "vitest";
import { composerLooksEmpty, detectActivity } from "./activity";
import { choiceKeys, parseChoice } from "./choice";
import { parseOpencodeChoice, type ChoiceRow } from "./opencodeChoice";

const kimiEditor = ["╭──────────────────────╮", "│ >                    │", "╰──────────────────────╯", "test-model thinking /project", "context: 1% (17/256k)"].join("\n");
const ocEditor = ["┃", "┃", "┃", "┃ Build · test-model Belfry", "╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀", "/project 17 (0%) ctrl+p commands"].join("\n");
const claudeRule = "────────────────────────────────────────";
const claudeFooter = "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 1 agent";
const claudeEditor = (content = "❯ ", footer = claudeFooter) => [claudeRule, content, claudeRule, footer].join("\n");

describe("Claude text never establishes status or input ownership", () => {
  it.each([
    claudeFooter,
    "  ⏵⏵ accept edits on (shift+tab to cycle)",
    "  ⏸ plan mode on (shift+tab to cycle)",
    "  ? for shortcuts",
  ])("does not infer an empty input from footer %s", footer => {
    expect(composerLooksEmpty(claudeEditor("❯ ", footer), "claude")).toBe(false);
  });

  it.each([
    "❯ unsent draft",
    "❯ \n  second line of draft",
    "❯ [Pasted text #1 +3 lines]",
    "❯ [Image #1]",
  ])("preserves nonempty input %s even when shortcuts are visible", content => {
    for (const footer of [claudeFooter, "? for shortcuts"]) {
      expect(composerLooksEmpty(claudeEditor(content, footer), "claude")).toBe(false);
    }
  });

  it("does not treat the permission-mode footer alone as an empty input", () => {
    expect(composerLooksEmpty(claudeFooter, "claude")).toBe(false);
    expect(composerLooksEmpty(["❯ ", claudeRule, claudeFooter].join("\n"), "claude")).toBe(false);
    expect(composerLooksEmpty([claudeRule, "❯ ", claudeFooter].join("\n"), "claude")).toBe(false);
  });

  it("does not reuse an earlier empty composer when the current input has a draft", () => {
    expect(composerLooksEmpty(`${claudeEditor()}\n${claudeEditor("❯ draft")}`, "claude")).toBe(false);
  });

  it("does not treat a permission or selection prompt as an empty composer", () => {
    const choice = claudeEditor("Do you want to proceed?\n❯ 1. Yes\n  2. No");
    expect(composerLooksEmpty(choice, "claude")).toBe(false);
    expect(detectActivity(choice, "claude")).toBe("talking");
  });
});

describe("native composer and activity", () => {
  it("acknowledges a submitted Kimi prompt but preserves a user's draft", () => {
    expect(composerLooksEmpty(kimiEditor, "kimi")).toBe(true);
    expect(composerLooksEmpty(kimiEditor.replace("│ > ", "│ > draft"), "kimi")).toBe(false);
    expect(composerLooksEmpty(kimiEditor.replace("╰──", "│ extra line │\n╰──"), "kimi")).toBe(false);
    expect(composerLooksEmpty("? for shortcuts", "kimi")).toBe(false);
    expect(detectActivity(kimiEditor, "kimi")).toBe("idle");
    expect(detectActivity(` 🌒 · Tip: /tasks to check progress\n${kimiEditor}`, "kimi")).toBe("talking");
  });
  it("reads OpenCode's empty composer and interrupt hint", () => {
    expect(composerLooksEmpty(ocEditor, "opencode")).toBe(true);
    expect(composerLooksEmpty(ocEditor.replace("┃\n┃\n", "┃\n┃ UNSUBMITTED DRAFT\n"), "opencode")).toBe(false);
    expect(composerLooksEmpty(ocEditor.replace("┃\n┃\n", "┃\n┃\n┃ draft\n"), "opencode")).toBe(false);
    expect(detectActivity(`${ocEditor}\n⬝■■■■■■⬝ esc interrupt`, "opencode")).toBe("talking");
    expect(detectActivity(ocEditor, "opencode")).toBe("idle");
  });
});

it("parses Kimi approval descriptions without confusing them with selectable options", () => {
  const screen = ["▶ Run this command?", "$ pwd", "", "  1. Approve once", "     Run this command once.", "▶ 2. Approve for this session", "     Apply to commands in this session.", "  3. Reject", "", "↑/↓ select · 1/2/3 choose · ↵ confirm"].join("\n");
  const choice = parseChoice(screen, "kimi")!;
  expect(choice.question).toBe("▶ Run this command?");
  expect(choice.detail).toBe("$ pwd");
  expect(choice.options.map(option => option.index)).toEqual([1, 2, 3]);
  expect(choice.selected).toBe(2);
  expect(choiceKeys(choice, 1, false)).toBe("\u001b[A\r");
  expect(detectActivity(screen, "kimi")).toBe("awaiting-choice");
  expect(parseChoice(screen.replace("▶ 2.", "  2."), "kimi")).toBeNull();
});

// Colors captured from OpenCode 2.2.6, with an optional second button and any selection.
function ocPermission(selected = 1, twoOptions = false): ChoiceRow[] {
  const labels = twoOptions ? ["Allow once", "Reject"] : ["Allow once", "Always allow", "Reject"];
  return ["  ┃  △ Permission required", "  ┃  Tool: belfry_smoke_belfry_echo", `  ┃   ${labels.join("   ")}   ctrl+f fullscreen  ⇆ select  enter confirm`].map(text => ({ text, cell(column) {
    if (column === 2) return { foreground: "rgb:fab283", background: "rgb:141414" };
    const label = labels[selected - 1], at = text.indexOf(label);
    return at >= 0 && column >= at && column < at + label.length
      ? { foreground: "rgb:0a0a0a", background: "rgb:fab283" }
      : { foreground: "rgb:eeeeee", background: "rgb:1e1e1e" };
  } }));
}

describe("OpenCode colored permission buttons", () => {
  it.each([1, 2, 3])("uses the current selection %i and horizontal keys", selected => {
    const rows = ocPermission(selected), choice = parseOpencodeChoice(rows)!;
    expect(choice.selected).toBe(selected);
    expect(choiceKeys(choice, 1, false)).toBe("\u001b[D".repeat(selected - 1) + "\r");
    expect(detectActivity(rows.map(row => row.text).join("\n"), "opencode")).toBe("awaiting-choice");
  });
  it("supports two options without guessing the active color", () => {
    const choice = parseOpencodeChoice(ocPermission(2, true))!;
    expect(choice.options).toHaveLength(2);
    expect(choiceKeys(choice, 1, true)).toBe("\u001bOD\r");
    expect(parseOpencodeChoice(ocPermission().map(row => ({ ...row, cell: () => null })))).toBeNull();
    expect(parseOpencodeChoice(ocPermission().map(row => ({ ...row, cell: () => ({ foreground: "same", background: "same" }) })))).toBeNull();
  });
  it("refuses stale or incomplete screens", () => {
    const rows = ocPermission();
    expect(parseOpencodeChoice(rows.slice(1))).toBeNull();
    expect(parseOpencodeChoice(rows.map(row => ({ ...row, text: row.text.replace("⇆ select", "") })))).toBeNull();
    const original = parseOpencodeChoice(rows)!;
    expect(parseOpencodeChoice(ocPermission(2))!.signature).toBe(original.signature);
    expect(parseOpencodeChoice(rows.map(row => ({ ...row, text: row.text.replace("belfry_echo", "another_tool") })))!.signature).not.toBe(original.signature);
  });
});
