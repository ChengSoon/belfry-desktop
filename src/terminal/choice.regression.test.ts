import { expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { detectActivity } from "./activity";
import { parseChoice, readTerminalChoice } from "./choice";
import corpus from "./fixtures/codex-0.167.0.json";
import captured from "./fixtures/codex-current-menus.json";

it.each([
  ["current Codex permissions", captured.fixtures.permissions.screen],
  ["wrapped async options", corpus.fixtures["codex-async-wrapped"].screen],
  ["wrapped model descriptions", corpus.fixtures["codex-model-wrapped"].screen],
])("regression: %s remains available above the terminal", (_name, screen) => {
  expect(parseChoice(screen, "codex")).not.toBeNull();
});

it("regression: a freeform Codex question is waiting for the user", () => {
  expect(detectActivity(corpus.fixtures["codex-input-freeform"].screen, "codex")).toBe("awaiting-choice");
});

it("regression: a current non-numbered checkbox picker is waiting for the user", () => {
  expect(detectActivity(captured.fixtures.statusline.screen, "codex")).toBe("awaiting-choice");
});

it("regression: long visible command context is never truncated into the question", async () => {
  const terminal = new Terminal({ cols: 100, rows: 60, allowProposedApi: true });
  try {
    const detail = Array.from({ length: 35 }, (_, i) => `$ command-${i}`).join("\r\n");
    await new Promise<void>(resolve => terminal.write(`Would you like to run the following command?\r\n\r\n${detail}\r\n\r\n› 1. Yes\r\n  2. No\r\nPress enter to confirm or esc to cancel`, resolve));
    const choice = readTerminalChoice(terminal, "codex");
    expect(choice?.question).toBe("Would you like to run the following command?");
    expect(choice?.detail).toContain("$ command-0");
    expect(choice?.detail).toContain("$ command-34");
  } finally { terminal.dispose(); }
});
