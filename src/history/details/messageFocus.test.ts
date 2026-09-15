import { expect, it, vi } from "vitest";
import { focusMessageInPanel } from "./messageFocus";

it("centers a source message inside its panel without scrolling outer workbench containers", () => {
  const scrollTo = vi.fn();
  const focus = vi.fn();
  const panel = { scrollTop: 120, clientHeight: 400, getBoundingClientRect: () => ({ top: 100 }), scrollTo };
  const entry = { clientHeight: 80, getBoundingClientRect: () => ({ top: 600 }),
    closest: () => panel, focus, scrollIntoView: () => { throw new Error("outer containers must not scroll"); } };
  focusMessageInPanel(entry as unknown as HTMLElement);
  expect(scrollTo).toHaveBeenCalledWith({ top: 460 });
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});

it("keeps an oversized source message at its beginning", () => {
  const scrollTo = vi.fn();
  const panel = { scrollTop: 0, clientHeight: 200, getBoundingClientRect: () => ({ top: 100 }), scrollTo };
  const entry = { clientHeight: 500, getBoundingClientRect: () => ({ top: 150 }), closest: () => panel, focus: vi.fn() };
  focusMessageInPanel(entry as unknown as HTMLElement);
  expect(scrollTo).toHaveBeenCalledWith({ top: 50 });
});
