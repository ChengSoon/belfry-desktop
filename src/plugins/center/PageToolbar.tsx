// Adapted from PI-Desktop PluginsPage.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useRef } from "react";
import { usePluginsPage } from "./context";
import { cx } from "./ui";
import { IconSearch, IconX } from "./icons";
import { t } from "./i18n";
import { installedGroups } from "./helpers";

export function PageToolbar() {
  const { tab, setTab, query, setQuery, data, market } = usePluginsPage();
  const visible = installedGroups(data.plugins, query).reduce((count, group) => count + group.rows.length, 0);
  return <div className="plugins-toolbar">
    <div className="plugins-segment" role="tablist" aria-label={t("plugins.title")}>
      {(["installed", "market"] as const).map((id) => <button key={id} type="button" role="tab" id={`plugins-tab-${id}`}
        aria-selected={tab === id} aria-controls={`plugins-panel-${id}`} className={cx("plugins-segment-btn", tab === id && "active")}
        onClick={() => setTab(id)}>{t(id === "installed" ? "plugins.tabInstalled" : "plugins.tabMarket")}
        <span className="plugins-segment-count">{id === "installed" ? data.plugins.length : market.items.length || ""}</span></button>)}
    </div>
    <div className="plugins-toolbar-end">
      {tab === "installed" && query.trim() ? <span className="plugins-result-count" aria-live="polite">{t("plugins.resultCount", { count: visible, total: data.plugins.length })}</span> : null}
      {tab === "market" && market.loading ? <span className="plugins-result-count" aria-live="polite">{t("plugins.marketLoading")}</span> : null}
      {tab === "market" || data.plugins.length ? <SearchField value={tab === "installed" ? query : market.query}
        onChange={tab === "installed" ? setQuery : market.setQuery} placeholder={t(tab === "installed" ? "plugins.searchInstalled" : "plugins.marketSearchPlaceholder")} /> : null}
    </div>
  </div>;
}
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (next: string) => void; placeholder: string }) {
  const input = useRef<HTMLInputElement | null>(null);
  return <div className="plugins-search-wrap"><IconSearch size={14} />
    <input ref={input} className="plugins-search" value={value} placeholder={placeholder} aria-label={placeholder} spellCheck={false}
      autoCorrect="off" autoCapitalize="off" onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Escape" && value) { event.preventDefault(); event.stopPropagation(); onChange(""); } }} />
    {value ? <button type="button" className="plugins-search-clear" aria-label={t("plugins.clearSearch")} title={t("plugins.clearSearch")}
      onClick={() => { onChange(""); input.current?.focus(); }}><IconX size={12} /></button> : null}
  </div>;
}
