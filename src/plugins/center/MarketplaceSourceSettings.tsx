// Adapted from PI-Desktop MarketplaceSourceSettings.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useEffect, useState } from "react";
import { usePluginsPage } from "./context";
import { Button, Dropdown, Input } from "./ui";
import { t } from "./i18n";
import { centerApi } from "./api";
import type { MarketSettings, PluginMarketSource } from "./types";
import { PersonalMarketControls } from "./PersonalMarketControls";

// 每个来源都带一句说明，占住标题下的预留位：切换来源时卡片高度不跳，说明也
// 和它描述的下拉留在同一行里。
const SOURCES: Array<{ value: PluginMarketSource; label: string; hint: string }> = [
  { value: "personal", label: "我的插件市场", hint: "插件存放在本机目录，可发布新版本并导出成独立站点。" },
  { value: "belfry", label: "Belfry 插件中心 · GitHub", hint: "从你的 GitHub 插件中心安装；仓库公开并发布目录后，其他人才能安装其中的插件。" },
  { value: "custom", label: "自有在线市场", hint: "从你自己的网址加载插件目录。" },
  { value: "official", label: "PI 公开市场 · GitHub", hint: "PI 官方维护的公开市场，直接从 GitHub 获取。" },
  { value: "mirror", label: "PI 公开市场 · 镜像", hint: "PI 公开市场的镜像源，GitHub 访问不畅时更稳定。" },
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
  const active = SOURCES.find((source) => source.value === settings.pluginMarketSource);
  return <section className="plugins-market-settings" aria-labelledby="plugins-market-settings-title">
    <div className="plugins-market-settings-head"><div className="plugins-market-settings-copy">
      <h2 id="plugins-market-settings-title" className="settings-card-heading">{t("settings.marketProviderTitle")}</h2>
      {active ? <p className="settings-row-desc">{active.hint}</p> : null}</div>
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
  </section>;
}
