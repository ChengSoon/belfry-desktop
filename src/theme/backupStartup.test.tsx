import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { createBackup } from "../backup/package";
import { applyPendingBackup, scheduleRestore, scheduleUndo } from "../backup/transaction";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { THEME_MODE_KEY } from "./storage";

function storage(theme: string | null) {
  const data = new Map<string, string>();
  if (theme !== null) data.set(THEME_MODE_KEY, theme);
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
}

function renderTheme(painted: string) {
  vi.stubGlobal("document", { documentElement: { dataset: { theme: painted } } });
  return renderToStaticMarkup(<ThemeProvider><Probe /></ThemeProvider>);
}

function Probe() {
  const { mode, pinned } = useTheme();
  return <span>{mode}:{pinned ? "pinned" : "system"}</span>;
}

afterEach(() => vi.unstubAllGlobals());

it("uses restored appearance on the first React render and honours undo despite the old first paint", () => {
  const current = storage("light");
  vi.stubGlobal("localStorage", current);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  scheduleRestore({ backup: createBackup(storage("dark")), domains: ["appearance"] }, current);
  expect(applyPendingBackup(current).error).toBeNull();
  expect(renderTheme("light")).toContain("dark:pinned");
  scheduleUndo(current);
  expect(applyPendingBackup(current).error).toBeNull();
  expect(renderTheme("dark")).toContain("light:pinned");
});

it("follows the system after restoring an unpinned theme instead of keeping the old painted mode", () => {
  const current = storage("light");
  vi.stubGlobal("localStorage", current);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  scheduleRestore({ backup: createBackup(storage(null)), domains: ["appearance"] }, current);
  expect(applyPendingBackup(current).error).toBeNull();
  expect(renderTheme("light")).toContain("dark:system");
});
