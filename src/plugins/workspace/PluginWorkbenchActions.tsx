import { PanelRight, Plug } from "lucide-react";
import { togglePluginDock, togglePluginLauncher } from "./events";
import "./workspace.css";

export function PluginWorkbenchActions({ open }: { open: boolean }) {
  return <div className="plugin-workbench-actions">
    <button type="button" className="icon-button icon-button--sm" aria-label="插件启动器" title="插件启动器 Alt+Space" onClick={togglePluginLauncher}><Plug size={16} /></button>
    <button type="button" className="icon-button icon-button--sm" aria-label="插件工作面板" aria-expanded={open}
      title="插件工作面板" onClick={togglePluginDock}><PanelRight size={16} /></button>
  </div>;
}
