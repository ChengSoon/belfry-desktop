import { describe, expect, it, vi } from "vitest";
import { findTextMatches, TerminalSearchController } from "./search";

describe("terminal search", () => {
  it("finds all case-insensitive non-overlapping matches", () => {
    expect(findTextMatches("Belfry belfry BELFRY", "bElFrY")).toEqual([
      { offset: 0, length: 6 },
      { offset: 7, length: 6 },
      { offset: 14, length: 6 },
    ]);
  });

  it("selects a wide-character match using terminal cell coordinates", () => {
    const line = fakeLine([
      ["a", 1],
      ["你", 2],
      ["", 0],
      ["b", 1],
    ]);
    const terminal = fakeTerminal([line]);
    const controller = new TerminalSearchController(terminal as never);

    const state = controller.search("你");

    expect(state.matches).toEqual([{ line: 0, column: 1, length: 2, text: "你" }]);
    expect(terminal.select).toHaveBeenCalledWith(1, 0, 2);
    expect(terminal.scrollToLine).toHaveBeenCalledWith(0);
  });

  it("cycles forward and backward through matches", () => {
    const line = fakeLine([..."one two one"].map((character) => [character, 1]));
    const terminal = fakeTerminal([line]);
    const controller = new TerminalSearchController(terminal as never);

    controller.search("one");
    expect(controller.state.activeIndex).toBe(0);
    controller.findNext();
    expect(controller.state.activeIndex).toBe(1);
    controller.findNext();
    expect(controller.state.activeIndex).toBe(0);
    controller.findPrevious();
    expect(controller.state.activeIndex).toBe(1);
  });

  it("finds a match that crosses wrapped buffer lines", () => {
    const first = fakeLine([..."hello worl"].map((character) => [character, 1]), false);
    const second = fakeLine([["d", 1]], true);
    const terminal = fakeTerminal([first, second], 10);
    const controller = new TerminalSearchController(terminal as never);

    const state = controller.search("world");

    expect(state.matches).toEqual([{ line: 0, column: 6, length: 5, text: "world" }]);
    expect(terminal.select).toHaveBeenCalledWith(6, 0, 5);
  });
});

function fakeLine(cells: Array<[string, number]>, isWrapped = false) {
  return {
    isWrapped,
    length: cells.length,
    getCell: (index: number) => {
      const cell = cells[index];
      return cell
        ? { getChars: () => cell[0], getWidth: () => cell[1] }
        : undefined;
    },
    translateToString: (
      trimRight = false,
      startColumn = 0,
      endColumn = cells.length,
      outColumns?: number[],
    ) => {
      let end = Math.min(endColumn, cells.length);
      if (trimRight) {
        while (end > startColumn && cells[end - 1]?.[0] === "") end -= 1;
      }
      let text = "";
      for (let column = startColumn; column < end; column += 1) {
        const [chars, width] = cells[column] ?? ["", 0];
        if (width === 0) continue;
        const value = chars || " ";
        text += value;
        for (let offset = 0; offset < value.length; offset += 1) outColumns?.push(column);
      }
      outColumns?.push(end);
      return text;
    },
  };
}

function fakeTerminal(lines: unknown[], cols = 80) {
  return {
    cols,
    buffer: { active: { length: lines.length, getLine: (index: number) => lines[index] } },
    clearSelection: vi.fn(),
    scrollToLine: vi.fn(),
    select: vi.fn(),
    focus: vi.fn(),
  };
}
