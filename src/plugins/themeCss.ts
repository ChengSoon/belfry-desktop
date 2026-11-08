import { t } from "../i18n";
// Adapted from PI-Desktop plugin-sdk/theme-css.ts, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
export const THEME_CSS_MAX_BYTES = 256 * 1024;
type ThemeCssResult = { ok: true; css: string } | { ok: false; error: string };

/** 保留整份主题；先按 CSS 转义规则检查所有可发起网络加载的写法。 */
export function sanitizeThemeCss(raw: string): ThemeCssResult {
  const css = raw.replace(/^\uFEFF/, "");
  if (new TextEncoder().encode(css).length > THEME_CSS_MAX_BYTES) return invalid(t("plugins.themeCss.text_cf2f20ffe5"));
  if (!css.trim()) return invalid(t("plugins.themeCss.text_fd7d63517b"));
  const normalized = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\\(?:([0-9a-f]{1,6})\s?|([^\r\n]))/gi, (_, hex, char) => {
    const point = hex ? parseInt(hex, 16) : 0;
    return hex ? String.fromCodePoint(point > 0 && point <= 0x10ffff ? point : 0xfffd) : char;
  });
  if (/@(?:import|namespace)\b/i.test(normalized)) return invalid(t("plugins.themeCss.text_bad035bf3c"));
  if (/<\/?\s*style|<!--/i.test(normalized)) return invalid(t("plugins.themeCss.text_c5adbd5a65"));
  if (/javascript\s*:|expression\s*\(/i.test(normalized)) return invalid(t("plugins.themeCss.text_173a37c738"));
  let validUrls = 0;
  const withoutUrls = normalized.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match, _quote, target: string) => {
    if (/^data:/i.test(target.trim())) { validUrls++; return "none"; }
    return match;
  });
  if ((normalized.match(/url\s*\(/gi) ?? []).length !== validUrls) return invalid(t("plugins.themeCss.text_654496bf59"));
  if (/(?:image-set|image|src)\s*\([^)]*['"]/i.test(withoutUrls)) return invalid(t("plugins.themeCss.text_bf2b2e2e4c"));
  return { ok: true, css: css.trim() };
}
function invalid(error: string): ThemeCssResult { return { ok: false, error }; }

/** PI 的主题变量同时驱动宿主外观，CSS 正文仍原样注入。 */
export const HOST_THEME_ALIASES = `:root[data-plugin-theme] {
  --canvas: var(--ds-bg-primary); --surface: var(--ds-bg-secondary);
  --surface-raised: var(--ds-bg-tertiary); --surface-hover: var(--ds-bg-hover);
  --sidebar: var(--ds-bg-sidebar); --sidebar-hover: var(--ds-bg-hover); --sidebar-active: var(--ds-bg-active);
  --text: var(--ds-text-primary); --text-muted: var(--ds-text-secondary); --text-faint: var(--ds-text-muted);
  --accent: var(--ds-accent); --accent-hover: var(--ds-accent-hover); --accent-soft: var(--ds-accent-soft);
  --accent-contrast: var(--ds-bg-primary); --border: var(--ds-border-default); --border-strong: var(--ds-border-strong);
  --success: var(--ds-success); --warning: var(--ds-warning); --danger: var(--ds-error);
}`;
