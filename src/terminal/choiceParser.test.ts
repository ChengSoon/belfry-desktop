import { describe, expect, it } from "vitest";
import { parseInteractionText } from "./choiceParser";
import { detectActivity } from "./activity";
import { parseChoice } from "./choice";
import corpus from "./fixtures/codex-0.167.0.json";

const screen = (name: keyof typeof corpus.fixtures) => corpus.fixtures[name].screen;
const parse = (name: keyof typeof corpus.fixtures) => parseInteractionText(screen(name), "codex")!;

describe("Codex 0.167.0 rendered requests", () => {
  it("joins manually wrapped async options instead of losing the menu", () => {
    const request = parse("codex-async-wrapped");
    expect(request.kind).toBe("single");
    expect(request.question).toBe("Second");
    expect(request.options).toEqual([
      { index: 1, label: "A suggested answer that is\nlong enough to wrap across\nmultiple rows" },
      { index: 2, label: "Other" },
    ]);
    expect(detectActivity(screen("codex-async-wrapped"), "codex")).toBe("talking");
  });

  it("separates option descriptions, including two columns wrapping on the same rows", () => {
    const request = parse("codex-input-options");
    expect(request.options[0]).toEqual({ index: 1, label: "Option 1", description: "First choice." });
    const long = parse("codex-input-long");
    expect(long.options).toHaveLength(2);
    expect(long.options[0].label).toBe("Job: running/completed/failed/expired; Run/Experiment: succeeded/failed/\nunknown (Recommended when triaging long-running background work and status\ntransitions)");
    expect(long.options[0].description).toBe("Keep async job statuses for\nprogress tracking and include\nenough context for debugging\nretries, stale workers, and\nunexpected expiration paths.");
  });

  it("keeps model descriptions outside labels and preserves the question", () => {
    const request = parse("codex-model-wrapped");
    expect(request.kind).toBe("single");
    expect(request.question).toBe("Select Model and Effort");
    expect(request.options[0].label).toBe("gpt-5.1-codex (current)");
    expect(request.options[0].description).toBe("Optimized for Codex. Balance of reasoning quality\nand coding ability.");
  });

  it("identifies freeform and notes as input, not a list or normal composer", () => {
    for (const name of ["codex-input-freeform", "codex-input-notes", "codex-async-input"] as const) {
      expect(parse(name).kind, name).toBe("input");
      expect(parse(name).control, name).toBe("text");
      expect(parse(name).inputValue, name).toBe("");
      expect(detectActivity(screen(name), "codex"), name).toBe("talking");
    }
    const async = parse("codex-async-input");
    expect(async.detail).toContain("printf '診 断 '");
    expect(async.detail).toContain("https://example.com/diagnostics?view=full");
  });

  it("includes the current question number in request identity", () => {
    const first = parse("codex-input-first"), last = parse("codex-input-last");
    expect(first.detail).toContain("Question 1/2");
    expect(last.detail).toContain("Question 2/2");
    expect(first.signature).not.toBe(last.signature);
    expect(parseInteractionText(screen("codex-input-first").replace("› 1.", "  1.").replace("  2. Option", "› 2. Option"), "codex")?.signature).toBe(first.signature);
  });

  it("keeps permissions and unanswered-question confirmation explicit", () => {
    const permissions = parse("codex-permissions");
    expect(permissions.kind).toBe("confirmation");
    expect(permissions.detail).toContain("read `/tmp/readme.txt`; write `/tmp/out.txt`");
    expect(permissions.options).toHaveLength(4);
    expect(parse("codex-unanswered").kind).toBe("confirmation");
  });

  it("exposes only known numbered page options and marks remaining options", () => {
    const request = parse("codex-input-hidden");
    expect(request.kind).toBe("single");
    expect(request.options.map(option => option.index)).toEqual([2, 3, 4]);
    expect(request.selected).toBe(4);
    expect(request.optionsComplete).toBe(false);
  });

  it("retains unknown requests with remapped submit keys without synthesizing Enter", () => {
    for (const name of ["codex-async-remapped", "codex-input-remapped"] as const) {
      expect(parse(name).kind, name).toBe("unknown");
      expect(parse(name).control, name).toBe("none");
      expect(detectActivity(screen(name), "codex"), name).toBe("talking");
    }
  });

  it("keeps Codex's clipped approval context terminal-only until it can be reviewed", () => {
    // Codex 0.167.0 approval_overlay/clipping_tests.rs, bound=true 40x10.
    const text = "  Would you like to run the following\n  command?\n\n  [… 43 lines] ⌃g view all\n› 1. Yes, proceed (y)\n  2. No, and tell Codex what to do\n     differently (esc)\n  Press enter to confirm or esc to\n  cancel";
    expect(parseInteractionText(text, "codex")?.kind).toBe("unknown");
    expect(parseChoice(text, "codex")).toBeNull();
  });
});

describe("interaction evidence and native compatibility", () => {
  it("keeps a new-conversation menu and its descriptions", () => {
    const request = parseInteractionText("Where should the new conversation run?\n\n› 1. Use current Git worktree  Keep using the current working directory\n  2. Create new Git worktree  Create a separate checkout of this repository in another directory\n\nenter select · esc back", "codex")!;
    expect(request.options[0]).toEqual({ index: 1, label: "Use current Git worktree", description: "Keep using the current working directory" });
    expect(request.kind).toBe("single");
  });

  it("does not silently truncate a long command or its safety context", () => {
    const detail = Array.from({ length: 40 }, (_, i) => `$ command-${i}`).join("\n");
    const request = parseInteractionText(`Would you like to run the following command?\n\n${detail}\n\n› 1. Yes\n  2. No\nPress enter to confirm or esc to cancel`, "codex")!;
    expect(request.question).toBe("Would you like to run the following command?");
    expect(request.detail).toBe(detail);
  });

  it("reads a full non-numbered checkbox menu independently from the current cursor", () => {
    const text = "Status line\n\nType to search\n\n› [x] Model  Current model\n  [ ] Tokens  Tokens used\n  [x] Branch  Git branch\n\nspace toggle · ←/→ reorder · enter save · esc cancel";
    const request = parseInteractionText(text, "codex")!;
    expect(request.kind).toBe("multiple");
    expect(request.selected).toBe(1);
    expect(request.selectedIndices).toEqual([1, 3]);
    expect(request.options[1]).toEqual({ index: 2, label: "Tokens", description: "Tokens used" });
    const moved = parseInteractionText(text.replace("› [x] Model", "  [x] Model").replace("  [ ] Tokens", "› [x] Tokens"), "codex")!;
    expect(moved.signature).toBe(request.signature);
    expect(moved.selected).toBe(2);
    expect(moved.selectedIndices).toEqual([1, 2, 3]);
    expect(parseInteractionText(text.replace("\n\nspace", "\n↓\nspace"), "codex")?.kind).toBe("unknown");
    expect(parseInteractionText(text.replace("Type to search", "mod"), "codex")?.kind).toBe("unknown");
  });

  it("preserves CJK titles and multi-line descriptions", () => {
    const request = parseInteractionText("请选择运行方式\n\n› 1. 当前目录  保留当前项目\n  2. 新建目录  在独立目录中运行\n               可稍后删除\n\n回车确认，方向键选择", "codex")!;
    expect(request.options[0]).toEqual({ index: 1, label: "当前目录", description: "保留当前项目" });
    expect(request.options[1].label).toBe("新建目录");
    expect(request.options[1].description).toBe("在独立目录中运行\n可稍后删除");
  });

  it("supports explicit y/n without choosing the displayed default", () => {
    for (const prompt of ["Continue? (y/n)", "是否继续？[Y/n]："]) {
      const request = parseInteractionText(prompt)!;
      expect(request.kind).toBe("confirmation");
      expect(request.selected).toBeNull();
      expect(request.answers).toEqual(["y", "n"]);
    }
    expect(parseChoice("Continue? (y/n)")).toBeNull(); // legacy remains single-menu only
  });

  it.each([
    "Would you like to run the following command? This is quoted documentation.",
    "Pick an option?\n1. One\n2. Two",
    "> 1. Quoted item\n  2. Another item",
    "Options:\n> 1. Quoted item\n  2. Another item\nenter select · esc back",
    "A checklist\n[x] Done\n[ ] Later",
    "Example (y/n)\n$ ",
    "Choose\n› 1. One\n  2. Two\n\n› \n? for shortcuts",
    "Menu example:\n```text\nChoose\n› 1. One\n  2. Two\nenter select · esc back\n```",
    "Use enter to confirm in the settings.",
    "Press enter to confirm or esc to cancel",
    "The answer is final.\nPress enter to confirm or esc to cancel",
  ])("does not treat prose or a completed menu as a request: %s", text => {
    expect(parseInteractionText(text, "codex")).toBeNull();
    expect(detectActivity(text, "codex")).toBe("talking");
  });

  it("does not reuse a finished menu below resumed work", () => {
    const text = "Choose\n› 1. One\n  2. Two\nenter select · esc back\n• Working (Esc to interrupt)";
    expect(parseInteractionText(text, "codex")).toBeNull();
    expect(detectActivity(text, "codex")).toBe("talking");
  });
});
