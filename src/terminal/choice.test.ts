import { describe, expect, it } from "vitest";
import { detectActivity } from "./activity";
import { choiceKeys, parseChoice } from "./choice";

const codexApproval = [
  "• Ran git status",
  "",
  "  Would you like to run the following command?",
  "",
  "  $ rm -rf tmp/*.png",
  "",
  "› 1. Yes, proceed (y)",
  "  2. Yes, and don't ask again for this command in this session (p)",
  "  3. No, and tell Codex what to do differently (esc)",
  "",
  "  Press enter to confirm or esc to cancel",
].join("\n");

const claudePermission = [
  "╭─────────────────────────────────────────────╮",
  "│ Bash command                                 │",
  "│                                              │",
  "│   npm install left-pad                       │",
  "│                                              │",
  "│ Do you want to proceed?                      │",
  "│ ❯ 1. Yes                                     │",
  "│   2. Yes, and don't ask again for npm        │",
  "│   3. No, and tell Claude what to do (esc)    │",
  "╰─────────────────────────────────────────────╯",
].join("\n");

describe("parseChoice", () => {
  it("reads a Codex approval: question, command and options", () => {
    const choice = parseChoice(codexApproval);
    expect(choice).not.toBeNull();
    expect(choice?.question).toBe("Would you like to run the following command?");
    expect(choice?.detail).toBe("$ rm -rf tmp/*.png");
    expect(choice?.options.map((option) => option.label)).toEqual([
      "Yes, proceed (y)",
      "Yes, and don't ask again for this command in this session (p)",
      "No, and tell Codex what to do differently (esc)",
    ]);
    expect(choice?.selected).toBe(1);
  });

  it("reads a Claude permission box and strips the border", () => {
    const choice = parseChoice(claudePermission);
    expect(choice?.question).toBe("Do you want to proceed?");
    expect(choice?.options).toHaveLength(3);
    expect(choice?.options[0].label).toBe("Yes");
  });

  it("follows the cursor when it has moved", () => {
    const moved = codexApproval.replace("› 1.", "  1.").replace("  2. Yes, and", "› 2. Yes, and");
    expect(parseChoice(moved)?.selected).toBe(2);
  });

  it("refuses what it cannot be sure about", () => {
    expect(parseChoice("1. first\n2. second"), "no cursor: an ordinary list").toBeNull();
    expect(parseChoice("Pick one\n› 1. a"), "a single option").toBeNull();
    expect(parseChoice("Pick one\n› 1. a\n  3. c"), "numbers skip").toBeNull();
    expect(parseChoice("Pick one\n› 1. a\n› 2. b"), "two cursors").toBeNull();
    expect(parseChoice("Continue? (y/n) "), "y/n prompt has no options").toBeNull();
  });

  it("gives the same signature for the same screen and a different one when it changes", () => {
    const first = parseChoice(codexApproval)!;
    expect(parseChoice(codexApproval)!.signature).toBe(first.signature);
    expect(parseChoice(codexApproval.replace("tmp/*.png", "dist"))!.signature).not.toBe(first.signature);
  });
});

describe("choiceKeys", () => {
  const choice = parseChoice(codexApproval)!;

  it("moves from the cursor with arrows then presses enter", () => {
    expect(choiceKeys(choice, 1, false)).toBe("\r");
    expect(choiceKeys(choice, 3, false)).toBe("\u001b[B\u001b[B\r");
    expect(choiceKeys({ ...choice, selected: 3 }, 1, false)).toBe("\u001b[A\u001b[A\r");
  });

  it("uses application cursor sequences when the terminal asks for them", () => {
    expect(choiceKeys(choice, 2, true)).toBe("\u001bOB\r");
  });

  it("refuses an option that is not on screen", () => {
    expect(choiceKeys(choice, 4, false)).toBeNull();
  });
});

describe("Codex screens and activity", () => {
  it("reads the Codex approval as awaiting-choice", () => {
    expect(detectActivity(codexApproval.split("\n").slice(-12).join("\n"))).toBe("awaiting-choice");
  });

  it("reads the Codex working line even when the key name is drawn as a symbol", () => {
    expect(detectActivity("• Working (12s • ⎋ to interrupt)")).toBe("talking");
    expect(detectActivity("  (press esc to interrupt and send immediately)")).toBe("talking");
  });
});
