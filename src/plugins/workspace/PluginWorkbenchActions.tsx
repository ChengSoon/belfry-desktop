import { t, useTranslation } from "../../i18n";
import { PanelRight, Plug } from "lucide-react";
import { togglePluginDock, togglePluginLauncher } from "./events";
import "./workspace.css";

export function PluginWorkbenchActions({ open }: { open: boolean }) {
  useTranslation();
  return <div className="plugin-workbench-actions">
    <button type="button" className="icon-button icon-button--sm" aria-label={t("plugins.PluginWorkbenchActions.text_85ef04ad0c")} title={t("plugins.PluginWorkbenchActions.text_84fb5c916f")} onClick={togglePluginLauncher}><Plug size={16} /></button>
    <button type="button" className="icon-button icon-button--sm" aria-label={t("plugins.PluginWorkbenchActions.text_75288484d2")} aria-expanded={open}
      title={t("plugins.PluginWorkbenchActions.text_75288484d2")} onClick={togglePluginDock}><PanelRight size={16} /></button>
  </div>;
}
