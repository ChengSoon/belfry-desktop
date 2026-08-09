import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ThemeController, ThemeMode } from "./contracts";
import { loadThemeMode, saveThemeMode } from "./storage";

/** 与 styles.css 中两套 --canvas 令牌保持一致，用于同步系统标题栏配色。 */
const CANVAS_COLOR: Record<ThemeMode, string> = { dark: "#0a0a0b", light: "#fafafa" };

const LIGHT_QUERY = "(prefers-color-scheme: light)";

const ThemeContext = createContext<ThemeController | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState(initialMode);
  const [pinned, setPinned] = useState(() => loadThemeMode() !== null);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", CANVAS_COLOR[mode]);
  }, [mode]);

  useEffect(() => {
    if (pinned) return;
    const query = window.matchMedia(LIGHT_QUERY);
    const sync = () => setMode(query.matches ? "light" : "dark");
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [pinned]);

  const select = useCallback((next: ThemeMode) => {
    setPinned(true);
    saveThemeMode(next);
    setMode(next);
  }, []);

  const controller = useMemo<ThemeController>(() => ({
    mode,
    pinned,
    select,
    toggle: () => select(mode === "light" ? "dark" : "light"),
  }), [mode, pinned, select]);

  return <ThemeContext value={controller}>{children}</ThemeContext>;
}

export function useTheme() {
  const controller = useContext(ThemeContext);
  if (!controller) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return controller;
}

/** 首帧脚本已经把结果写进 data-theme，优先读它，保证 React 状态与已渲染画面一致。 */
function initialMode(): ThemeMode {
  const applied = document.documentElement.dataset.theme;
  if (applied === "dark" || applied === "light") return applied;
  return loadThemeMode() ?? (window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark");
}
