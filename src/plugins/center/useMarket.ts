import { useCallback, useEffect, useRef, useState } from "react";
import { centerApi } from "./api";
import { pluginError } from "../hostClient";
import type { MarketPluginDetail, MarketPluginSummary } from "./types";
import type { TabId } from "./helpers";
import { loadMarketSnapshot } from "./marketLoading";

export function useMarket(tab: TabId) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<MarketPluginSummary[]>([]);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async (remote = false) => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      await loadMarketSnapshot({ query, remote, current: () => current === generation.current, apply: (result) => {
        setItems(result.plugins);
        setCategory((current) => result.plugins.some((item) => item.categories?.includes(current)) ? current : "");
        setSource(result.sourceUrl);
      } });
    } catch (reason) { if (current === generation.current) setError(pluginError(reason)); }
    finally { if (current === generation.current) setLoading(false); }
  }, [query]);
  useEffect(() => {
    if (tab !== "market") return;
    const timer = setTimeout(() => void refresh(), query.trim() ? 240 : 0);
    return () => { clearTimeout(timer); ++generation.current; };
  }, [tab, query, refresh]);
  const categories = [...new Set(items.flatMap((item) => item.categories ?? []))].sort();
  const visible = category ? items.filter((item) => item.categories?.includes(category)) : items;
  return { query, setQuery, category, setCategory, items, visible, categories, loading, error, source, refresh };
}

export function useMarketDetail() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MarketPluginDetail | null>(null);
  const [version, setVersion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const open = async (id: string) => {
    const current = ++generation.current;
    setSelectedId(id); setDetail(null); setLoading(true); setError("");
    try {
      const value = await centerApi.marketDetail(id);
      if (current !== generation.current) return;
      setDetail(value); setVersion(value.latestVersion);
    } catch (reason) { if (current === generation.current) setError(pluginError(reason)); }
    finally { if (current === generation.current) setLoading(false); }
  };
  const close = () => { ++generation.current; setSelectedId(null); setDetail(null); setVersion(""); };
  useEffect(() => () => { ++generation.current; }, []);
  const activeVersion = detail?.versions.find((item) => item.version === version) ?? detail?.versions[0];
  return { selectedId, detail, version, setVersion, activeVersion, loading, error, open, close };
}
