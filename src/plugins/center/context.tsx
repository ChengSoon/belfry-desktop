import { createContext, useContext, useEffect, useState } from "react";
import { useCenterData } from "./useCenterData";
import { useCenterActions } from "./useCenterActions";
import { useMarket, useMarketDetail } from "./useMarket";
import type { TabId, TemplateId } from "./helpers";
import type { PluginSummary } from "./types";

export function usePageModel() {
  const [tab, setTab] = useState<TabId>("installed");
  const [query, setQuery] = useState("");
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [settingsPlugin, setSettingsPlugin] = useState<PluginSummary | null>(null);
  const [publishDirectory, setPublishDirectory] = useState<string | null>(null);
  const data = useCenterData();
  const market = useMarket(tab);
  const detail = useMarketDetail();
  const actions = useCenterActions(data.refresh);
  const [currentProjectPath, setProjectPath] = useState<string | null>(() => currentWorkspace());
  useEffect(() => {
    const update = () => setProjectPath(currentWorkspace());
    window.addEventListener("plugin-workspace-changed", update);
    return () => window.removeEventListener("plugin-workspace-changed", update);
  }, []);
  return { tab, setTab, query, setQuery, template, setTemplate, settingsPlugin, setSettingsPlugin, publishDirectory, setPublishDirectory,
    data, market, detail, actions, currentProjectPath };
}
function currentWorkspace(): string | null {
  return document.documentElement.dataset.pluginWorkspace || null;
}
export type PageModel = ReturnType<typeof usePageModel>;
export const PageContext = createContext<PageModel | null>(null);
export function usePluginsPage() {
  const model = useContext(PageContext);
  if (!model) throw new Error("缺少插件页面上下文");
  return model;
}
