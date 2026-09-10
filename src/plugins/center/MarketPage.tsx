// Adapted from PI-Desktop PluginsPage.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { usePluginsPage } from "./context";
import { Button, cx } from "./ui";
import { IconCheck, IconSearch, IconShield } from "./icons";
import { t } from "./i18n";
import { formatDate, monogram, showsVerifiedBadge } from "./helpers";
import { PermissionChips } from "./PermissionChips";
import type { MarketPluginSummary } from "./types";
import { MarketplaceSourceSettings } from "./MarketplaceSourceSettings";
import { centerApi } from "./api";

export function MarketPage() {
  const { market } = usePluginsPage();
  return <div id="plugins-panel-market" role="tabpanel" aria-labelledby="plugins-tab-market" className="plugins-panel">
    <MarketplaceSourceSettings />
    {market.error ? <MarketFailure /> : null}
    {market.categories.length > 1 ? <div className="plugins-filters" role="group" aria-label={t("plugins.categories")}>
      <button type="button" className={cx("plugins-filter", !market.category && "active")} aria-pressed={!market.category} onClick={() => market.setCategory("")}>{t("plugins.categoryAll")}</button>
      {market.categories.map((value) => <button key={value} type="button" className={cx("plugins-filter", market.category === value && "active")}
        aria-pressed={market.category === value} onClick={() => market.setCategory(market.category === value ? "" : value)}>{value}</button>)}
    </div> : null}
    {market.loading && !market.items.length ? <div className="plugins-card-grid" aria-hidden>{[0, 1, 2, 3].map((index) =>
      <div key={index} className="plugins-card is-skeleton"><span className="plugins-skeleton-line is-short" /><span className="plugins-skeleton-line" /><span className="plugins-skeleton-line is-long" /></div>)}</div>
      : !market.visible.length ? <MarketEmpty /> : <div className="plugins-card-grid" role="list">{market.visible.map((item) => <MarketCard key={item.id} item={item} />)}</div>}
    {market.source && !market.source.startsWith("belfry-market:") ? <p className="plugins-source-foot">市场地址：{market.source}</p> : null}
  </div>;
}
function MarketFailure() {
  const { market, data, actions } = usePluginsPage();
  const recover = () => actions.run(async () => {
    const settings = { ...data.management.settings, pluginMarketSource: "personal" as const };
    await centerApi.setSource(settings);
    data.setManagement((current) => ({ ...current, settings }));
    await market.refresh();
  });
  return <div><p className="plugins-inline-error" role="alert">{market.error}</p>
    {data.management.settings.pluginMarketSource !== "personal" ? <Button disabled={actions.busy} onClick={() => void recover()}>使用我的插件市场</Button> : null}
  </div>;
}
function MarketEmpty() {
  const { market, data, setTemplate } = usePluginsPage();
  const personal = data.management.settings.pluginMarketSource === "personal";
  return <div className="plugins-empty"><span className="plugins-empty-icon" aria-hidden><IconSearch size={18} /></span>
    <p className="plugins-empty-title">{market.error ? "市场暂不可用" : personal && !market.query ? "发布你的第一个插件" : t("plugins.marketEmpty")}</p>
    {personal && !market.query ? <p className="plugins-author-hint">从模板开始制作，调试后发布到这里，也可以导出市场供别人安装。</p> : null}
    <div className="plugins-empty-actions">
      {personal && !market.query ? <Button variant="primary" onClick={() => setTemplate("panel-basic")}>从模板创建插件</Button> : null}
      {market.query || market.category ? <Button onClick={() => { market.setQuery(""); market.setCategory(""); }}>{t("plugins.clearSearch")}</Button> : null}
      <Button disabled={market.loading} onClick={() => void market.refresh(true)}>{t("plugins.refreshMarket")}</Button></div>
  </div>;
}
function MarketCard({ item }: { item: MarketPluginSummary }) {
  const { data, detail } = usePluginsPage();
  const installed = data.plugins.find((plugin) => plugin.id === item.id);
  return <article role="listitem" className={cx("plugins-card", detail.selectedId === item.id && "active")}>
    <button type="button" className="plugins-card-hit" aria-label={t("plugins.viewDetailsOf", { name: item.name })} onClick={() => void detail.open(item.id)}>
      <span className="plugins-card-head"><span className="plugins-card-glyph" aria-hidden>{monogram(item.name)}</span>
        <span className="plugins-card-ident"><span className="plugins-card-title"><span className="plugins-card-name">{item.name}</span>
          {showsVerifiedBadge(item) ? <span className="plugins-verified" title={t("plugins.verified")} aria-label={t("plugins.verified")}><IconShield size={12} /></span> : null}</span>
          <span className="plugins-card-meta"><span className="plugins-card-author">{item.author}</span><span className="plugins-dot" aria-hidden>·</span><span>v{item.latestVersion}</span>
            {item.downloads != null ? <><span className="plugins-dot" aria-hidden>·</span><span>{t("plugins.downloads", { count: item.downloads })}</span></> : null}</span>
        </span></span><span className="plugins-card-desc">{item.description}</span><PermissionChips permissions={item.permissionSummary} />
    </button><div className="plugins-card-foot"><span className="plugins-card-state">{installed ? t("plugins.installedVersion", { version: installed.version }) : t("plugins.updatedOn", { date: formatDate(item.updatedAt) })}</span>
      <MarketCardAction item={item} /></div>
  </article>;
}
function MarketCardAction({ item }: { item: MarketPluginSummary }) {
  const { data, actions } = usePluginsPage();
  const installed = data.plugins.find((plugin) => plugin.id === item.id);
  const update = !!installed && !!item.updateAvailable, pending = item.installable === false;
  const installing = actions.installingId === item.id;
  if (installed && !update) return <span className="plugins-installed-mark"><IconCheck size={13} />{t("plugins.installedLabel")}</span>;
  return <Button variant="primary" size="sm" disabled={actions.busy || pending} title={pending ? t("plugins.packagePendingHint", { version: item.latestVersion }) : undefined}
    onClick={() => actions.queueInstall({ id: item.id, name: item.name, permissions: item.permissionSummary, version: item.latestVersion,
      newPermissions: installed ? item.permissionSummary.filter((permission) => !installed.permissions.includes(permission)) : [] })}>
    {t(pending ? "plugins.packagePending" : installing ? "plugins.installing" : update ? "plugins.updateNow" : "plugins.install")}
  </Button>;
}
