import { useEffect } from "react";
import { PageContext, usePageModel } from "./center/context";
import { PageHeader } from "./center/PageHeader";
import { PageToolbar } from "./center/PageToolbar";
import { InstalledPage } from "./center/InstalledPage";
import { MarketPage } from "./center/MarketPage";
import { MarketDetail } from "./center/MarketDetail";
import { InstallDialog } from "./center/InstallDialog";
import { TemplateDialog } from "./center/TemplateDialog";
import { PluginSettingsSheet } from "./center/PluginSettingsSheet";
import { PublishDialog } from "./center/PublishDialog";
import "./center/styles/index.css";

export function PluginPanel({ onGuardChange }: { onGuardChange?: (value: boolean) => void }) {
  const model = usePageModel();
  const guarded = [model.actions.busy, model.actions.pending, model.template, model.settingsPlugin, model.publishDirectory].some(Boolean);
  useEffect(() => { onGuardChange?.(guarded); return () => onGuardChange?.(false); }, [guarded, onGuardChange]);
  const error = model.actions.error || model.data.error;
  return <PageContext.Provider value={model}><section className="pi-plugins" aria-label="插件中心" aria-busy={model.actions.busy}>
    <div className="thread-scroll"><div className="page-frame plugins-page">
      <PageHeader /><PageToolbar />
      {error ? <p className="plugins-inline-error" role="alert">{error}</p> : null}
      {model.tab === "installed" ? <InstalledPage /> : <MarketPage />}
    </div>
      {model.detail.selectedId ? <MarketDetail /> : null}
      {model.actions.pending ? <InstallDialog /> : null}
      {model.settingsPlugin ? <PluginSettingsSheet key={model.settingsPlugin.id} /> : null}
      {model.template ? <TemplateDialog /> : null}
      {model.publishDirectory ? <PublishDialog key={model.publishDirectory} directory={model.publishDirectory} /> : null}
    </div>
  </section></PageContext.Provider>;
}
