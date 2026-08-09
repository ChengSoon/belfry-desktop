import { Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const label = mode === "light" ? "切换到暗色主题" : "切换到亮色主题";
  return (
    <button aria-label={label} className="icon-button" onClick={toggle} title={label} type="button">
      {mode === "light" ? <Moon aria-hidden="true" size={15} /> : <Sun aria-hidden="true" size={15} />}
    </button>
  );
}
