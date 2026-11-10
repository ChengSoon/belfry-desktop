import { describe, expect, it } from "vitest";
import { parseInteractionText } from "./choiceParser";
import { detectActivity } from "./activity";
import captured from "./fixtures/codex-queued-0.167.0.json";

const collapsed = `? Which sample color should the isolated preview use?
  • Blue sample
  • Green sample

◦ Working (14m 11s • esc to interrupt)

• Queued follow-up inputs
  ? 1 question
    shift+← to answer

› Ask Codex to do anything`;

describe("Codex background question entry", () => {
  it("reads the captured real queue, editor, Other and marker-free text input", () => {
    expect(parseInteractionText(captured.fixtures.collapsed.screen, "codex")?.kind).toBe("queued");
    const selection = parseInteractionText(captured.fixtures.expanded.screen, "codex");
    expect(selection?.question).toBe("Which sample color should the isolated preview use?");
    expect(selection?.options.at(-1)).toMatchObject({ index: 3, action: "input" });
    expect(parseInteractionText(captured.fixtures.other.screen, "codex")).toMatchObject({ kind: "input", inputValue: "" });
    expect(parseInteractionText(captured.fixtures.otherDraft.screen, "codex")).toMatchObject({ kind: "input", inputValue: "Purple sample" });
    expect(parseInteractionText(captured.fixtures.text.screen, "codex")).toMatchObject({ kind: "input", inputValue: "" });
    expect(parseInteractionText(captured.fixtures.textDraft.screen, "codex")).toMatchObject({ kind: "input", inputValue: "Sample note\n  Second line" });
  });

  it("recognizes a wrapped editor footer and an editor reached on a later question", () => {
    const screen = captured.fixtures.expanded.screen.replace("enter submit   ⌃] skip   ⇧→ main prompt", "enter submit\n  ⌃] skip\n  ⇧→ prev question");
    expect(parseInteractionText(screen, "codex")).toMatchObject({ kind: "single", asyncQuestion: true });
    expect(parseInteractionText(screen, "codex")?.options.at(-1)).toMatchObject({ action: "input" });
  });

  it("reads the captured two-question queue and preserves its actual page identity", () => {
    expect(parseInteractionText(captured.fixtures.pairCollapsed.screen, "codex")).toMatchObject({ kind: "queued", queue: { count: 2 } });
    const first = parseInteractionText(captured.fixtures.pairFirst.screen, "codex");
    const second = parseInteractionText(captured.fixtures.pairSecond.screen, "codex");
    expect(first).toMatchObject({ kind: "single", detail: "1 of 2", asyncQuestion: true });
    expect(second).toMatchObject({ kind: "input", detail: "2 of 2", asyncQuestion: true });
    expect(second?.signature).not.toBe(first?.signature);
  });

  it.each(["shift+←", "⇧←"])("detects the %s entry without treating history bullets as answers", key => {
    const request = parseInteractionText(collapsed.replace("shift+←", key), "codex");
    expect(request).toMatchObject({ kind: "queued", queue: { count: 1 }, question: "", options: [], input: null });
    expect(detectActivity(collapsed, "codex")).toBe("talking");
  });

  it("keeps the entry identity across spinner and countdown updates", () => {
    const first = parseInteractionText(collapsed.replace("1 question", "2 questions · 20s"), "codex");
    const second = parseInteractionText(collapsed.replace("1 question", "2 questions · 19s").replace("◦ Working (14m 11s", "• Working (14m 12s"), "codex");
    expect(first?.kind).toBe("queued");
    expect(second?.signature).toBe(first?.signature);
  });

  it("invalidates a same-count entry when the visible question changes", () => {
    const before = parseInteractionText(collapsed, "codex");
    const after = parseInteractionText(collapsed.replace("sample color", "sample border"), "codex");
    expect(before?.kind).toBe("queued");
    expect(after?.signature).not.toBe(before?.signature);
  });

  it.each([
    collapsed.replace("shift+←", "ctrl+q"),
    collapsed.replace("    shift+← to answer\n", ""),
    collapsed.replace("Ask Codex to do anything", "My unfinished message"),
    collapsed.replace("Ask Codex to do anything", "Ask Codex to do anything\n  my second line"),
  ])("keeps changed keys, incomplete hints and existing drafts terminal-only", screen => {
    expect(parseInteractionText(screen, "codex")).toMatchObject({ kind: "unknown", queue: { count: 1 }, options: [] });
    expect(detectActivity(screen, "codex")).toBe("talking");
  });

  it.each([
    `\`\`\`text\n${collapsed}\n\`\`\``,
    collapsed.split("\n").map(line => `> ${line}`).join("\n"),
    collapsed.replace("• Queued follow-up inputs", "A description of queued follow-up inputs"),
  ])("does not activate quoted or ordinary text", screen => {
    expect(parseInteractionText(screen, "codex")).toBeNull();
  });

  it("does not apply Codex queue key bindings to a different agent", () => {
    expect(parseInteractionText(collapsed, "claude")).toBeNull();
  });
});
