import { localized, useTranslation } from "../../i18n";
// Adapted from PI-Desktop MarketplaceSourceSettings.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useEffect, useState } from "react";
import { usePluginsPage } from "./context";
import { Button, Dropdown, Input } from "./ui";
import { t } from "./i18n";
import { centerApi } from "./api";
import type { MarketSettings, PluginMarketSource } from "./types";
import { PersonalMarketControls } from "./PersonalMarketControls";
import { guardComposingEnter } from "../../utils/keyboard";

// 每个来源都带一句说明，占住标题下的预留位：切换来源时卡片高度不跳，说明也
// 和它描述的下拉留在同一行里。
const SOURCES: Array<{ value: PluginMarketSource; label: string; hint: string }> = localized(() => ([
  { value: "personal", label: t("plugins.MarketplaceSourceSettings.text_391af6eb3e"), hint: t("plugins.MarketplaceSourceSettings.text_8ccf3293e1") },
  { value: "belfry", label: t("plugins.MarketplaceSourceSettings.text_96e37d56ab"), hint: t("plugins.MarketplaceSourceSettings.text_5c66ea2185") },
  { value: "custom", label: t("plugins.MarketplaceSourceSettings.text_f089223c8d"), hint: t("plugins.MarketplaceSourceSettings.text_7b5a1336a7") },
  { value: "official", label: t("plugins.MarketplaceSourceSettings.text_c2c1ddb426"), hint: t("plugins.MarketplaceSourceSettings.text_6cd2ab367c") },
  { value: "mirror", label: t("plugins.MarketplaceSourceSettings.text_7f57c0726c"), hint: t("plugins.MarketplaceSourceSettings.text_9edbacb262") },
]));

export function MarketplaceSourceSettings() {
  useTranslation();
  const { data, actions, market } = usePluginsPage();
  const settings = data.management.settings;
  const [customUrl, setCustomUrl] = useState(settings.pluginMarketCustomUrl);
  const [urlError, setUrlError] = useState("");
  useEffect(() => setCustomUrl(settings.pluginMarketCustomUrl), [settings.pluginMarketCustomUrl]);
  const apply = (patch: Partial<MarketSettings>) => actions.run(async () => {
    const next = { ...settings, ...patch };
    await centerApi.setSource(next);
    data.setManagement((current) => ({ ...current, settings: next }));
    await market.refresh();
  });
  const commit = () => {
    try {
      const url = new URL(customUrl.trim());
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
      setUrlError(""); void apply({ pluginMarketCustomUrl: customUrl.trim() });
    } catch { setUrlError(t("plugins.MarketplaceSourceSettings.text_4d97356dd3")); }
  };
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
      <form onKeyDown={guardComposingEnter} className="plugins-market-settings-control plugins-market-url-form" noValidate onSubmit={(event) => { event.preventDefault(); commit(); }}>
        <Input type="text" inputMode="url" aria-required="true" value={customUrl} disabled={actions.busy} aria-invalid={!!urlError}
        placeholder={t("settings.marketCustomUrlPlaceholder")} aria-label={t("settings.marketCustomUrl")} onChange={(event) => { setCustomUrl(event.target.value); setUrlError(""); }}
        /><Button type="submit" disabled={actions.busy}>{actions.busy ? t("plugins.MarketplaceSourceSettings.text_8be0ea36a9") : t("plugins.MarketplaceSourceSettings.text_107fecedcc")}</Button>
        {urlError ? <p className="plugins-settings-error" role="alert">{urlError}</p> : null}</form></div> : null}
    {settings.pluginMarketSource === "personal" ? <PersonalMarketControls /> : null}
  </section>;
}
