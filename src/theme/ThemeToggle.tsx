import { t, useTranslation } from "../i18n";
import { Moon, Sun } from "lucide-react";
import { ICON } from "./sizing";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  useTranslation();
  const { mode, toggle } = useTheme();
  const label = mode === "light" ? t("theme.ThemeToggle.text_5c00d3bba0") : t("theme.ThemeToggle.text_4d107af77a");
  return (
    <button aria-label={label} className="icon-button" onClick={toggle} title={label} type="button">
      {mode === "light" ? <Moon aria-hidden="true" size={ICON.lg} /> : <Sun aria-hidden="true" size={ICON.lg} />}
    </button>
  );
}
