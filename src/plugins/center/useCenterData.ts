import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDirectoryRegistry } from "../useDirectoryRegistry";
import { usePluginRuntime } from "../usePluginRuntime";
import { pluginError } from "../hostClient";
import { loadRecentProjects } from "../../workspace/storage";
import { centerApi, type ManagementSnapshot } from "./api";
import { pluginSummary, withUpdates } from "./summary";
import type { MarketPluginSummary } from "./types";

const EMPTY: ManagementSnapshot = { settings: { pluginMarketSource: "personal", pluginMarketCustomUrl: "" }, plugins: {} };
export function useCenterData() {
  const directory = useDirectoryRegistry();
  const runtime = usePluginRuntime();
  const [management, setManagement] = useState(EMPTY);
  const [market, setMarket] = useState<MarketPluginSummary[]>([]);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++epoch.current;
    await directory.refresh();
    try {
      const [preferences, catalog] = await Promise.all([centerApi.management(), centerApi.marketSearch()]);
      if (request !== epoch.current) return;
      setManagement(preferences); setMarket(catalog.plugins); setError("");
    } catch (reason) { if (request === epoch.current) setError(pluginError(reason)); }
  }, [directory.refresh]);
  useEffect(() => { void refresh(); return () => { ++epoch.current; }; }, [refresh]);
  const plugins = useMemo(() => directory.registry?.plugins.map((entry) =>
    withUpdates(pluginSummary(entry, runtime, management.plugins[entry.manifest.id]), market)) ?? [],
  [directory.registry, runtime, management, market]);
  const projects = loadRecentProjects().map((project) => ({ path: project.rootPath, name: project.name }));
  return { plugins, runtime, management, refresh, projects, registry: directory.registry,
    error: directory.error || error || runtime.error, setError, setManagement };
}
