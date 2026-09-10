// Adapted from PI-Desktop MarketplaceSourceSettings.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useEffect, useState } from "react";
import { usePluginsPage } from "./context";
import { Button, Dropdown, Input } from "./ui";
import { t } from "./i18n";
import { centerApi } from "./api";
import type { MarketSettings, PluginMarketSource } from "./types";
import { PersonalMarketControls } from "./PersonalMarketControls";

const SOURCES: Array<{ value: PluginMarketSource; label: string }> = [
  { value: "personal", label: "我的插件市场" },
  { value: "belfry", label: "Belfry 插件中心 · GitHub" },
  { value: "custom", label: "自有在线市场" },
  { value: "official", label: "PI 公开市场 · GitHub" },
  { value: "mirror", label: "PI 公开市场 · 镜像" },
];

export function MarketplaceSourceSettings() {
  const { data, actions, market } = usePluginsPage();
  const settings = data.management.settings;
  const [customUrl, setCustomUrl] = useState(settings.pluginMarketCustomUrl);
  useEffect(() => setCustomUrl(settings.pluginMarketCustomUrl), [settings.pluginMarketCustomUrl]);
  const apply = (patch: Partial<MarketSettings>) => actions.run(async () => {
    const next = { ...settings, ...patch };
    await centerApi.setSource(next);
    data.setManagement((current) => ({ ...current, settings: next }));
    await market.refresh();
  });
  const commit = () => void apply({ pluginMarketCustomUrl: customUrl.trim() });
  return <section className="plugins-market-settings" aria-labelledby="plugins-market-settings-title">
    <div className="plugins-market-settings-head"><div className="plugins-market-settings-copy">
      <h2 id="plugins-market-settings-title" className="settings-card-heading">{t("settings.marketProviderTitle")}</h2></div>
      <div className="plugins-market-settings-control"><Dropdown options={SOURCES} value={settings.pluginMarketSource}
        ariaLabel={t("settings.marketProvider")} disabled={actions.busy}
        onChange={(value) => void apply({ pluginMarketSource: value })} /></div></div>
    {settings.pluginMarketSource === "custom" ? <div className="plugins-market-settings-row"><div className="plugins-market-settings-copy">
      <div className="settings-row-title">{t("settings.marketCustomUrl")}</div><div className="settings-row-desc">{t("settings.marketCustomUrlDesc")}</div></div>
      <form className="plugins-market-settings-control plugins-market-url-form" onSubmit={(event) => { event.preventDefault(); commit(); }}>
        <Input type="url" required value={customUrl} disabled={actions.busy}
        placeholder={t("settings.marketCustomUrlPlaceholder")} aria-label={t("settings.marketCustomUrl")} onChange={(event) => setCustomUrl(event.target.value)}
        /><Button type="submit" disabled={actions.busy}>{actions.busy ? "正在连接…" : "保存并连接"}</Button></form></div> : null}
    {settings.pluginMarketSource === "personal" ? <PersonalMarketControls /> : null}
    {settings.pluginMarketSource === "belfry" ? <p className="settings-row-desc">此来源使用你的 GitHub 插件中心；仓库公开并发布目录后，其他人才能安装其中的插件。</p> : null}
  </section>;
}
