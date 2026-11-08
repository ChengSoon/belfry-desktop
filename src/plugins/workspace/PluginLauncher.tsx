import { useFeedback, t, useTranslation } from "../../i18n";
// Adapted from PI-Desktop PluginLauncher.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Plug, Search } from "lucide-react";
import { pluginHost } from "../useDirectoryRegistry";
import { useCenterData } from "../center/useCenterData";
import { useModal } from "../center/useModal";
import { pluginError } from "../hostClient";
import type { PluginSummary } from "../center/types";
import { searchLaunchablePlugins } from "./plugin-launcher-search";
import { loadPluginLaunchHistory, rememberPluginLaunch } from "./plugin-launcher-history";
import { useLauncherShortcut } from "./useLauncherShortcut";
import { isActiveInProject } from "../center/activation";
import "../center/styles/index.css";
import { composingKey } from "../../utils/keyboard";
import "./launcher.css";

export function PluginLauncher() {
  useTranslation();
  const launcher = useLauncherShortcut();
  return launcher.open ? <LauncherDialog onClose={launcher.close} shortcutNote={launcher.note} /> : null;
}
function LauncherDialog({ onClose, shortcutNote }: { onClose: () => void; shortcutNote: string }) {
  useTranslation();
  const { plugins, error: loadError } = useCenterData();
  const input = useRef<HTMLInputElement>(null), [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useFeedback("");
  const [recentIds] = useState(() => loadPluginLaunchHistory().map((record) => record.id));
  const workspace = document.documentElement.dataset.pluginWorkspace || null;
  const results = searchLaunchablePlugins(plugins.filter((plugin) => isActiveInProject(plugin, workspace)), query, recentIds).slice(0, 7);
  const modal = useModal(onClose);
  useEffect(() => { input.current?.focus(); }, []);
  const openPlugin = async (plugin: PluginSummary | undefined) => {
    if (!plugin || busy) return;
    setBusy(true); setError("");
    try { await pluginHost.openPanel(plugin.id); rememberPluginLaunch(plugin.id); onClose(); }
    catch (reason) { setError(() => pluginError(reason)); setBusy(false); }
  };
  return <div className="plugin-launcher-overlay pi-plugins" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="plugin-launcher" role="dialog" aria-modal="true" aria-label={t("plugins.PluginLauncher.text_9ac62a8a11")} ref={modal}>
      <div className="plugin-launcher-surface"><div className="plugin-launcher-search-row"><Search size={18} aria-hidden />
        <input ref={input} className="plugin-launcher-input" value={query} placeholder={t("plugins.PluginLauncher.text_87dba3065c")} autoComplete="off" spellCheck={false}
          role="combobox" aria-expanded={results.length > 0} aria-controls="plugin-launcher-results"
          aria-activedescendant={results[highlighted] ? `plugin-launcher-option-${results[highlighted].id}` : undefined}
          onChange={(event) => { setQuery(event.target.value); setHighlighted(0); }} onKeyDown={(event) => {
            if (composingKey(event.nativeEvent) || !results.length) return;
            if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setHighlighted((value) => (value + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length); }
            if (event.key === "Enter") { event.preventDefault(); void openPlugin(results[highlighted] ?? results[0]); }
          }} /><span className="plugin-launcher-shortcut" title={shortcutNote} aria-label={shortcutNote}>Alt + Space</span>
      </div><div className="plugin-launcher-results" id="plugin-launcher-results" role="listbox">
        {results.length ? results.map((plugin, index) => <button key={plugin.id} type="button" role="option" id={`plugin-launcher-option-${plugin.id}`}
          aria-selected={highlighted === index} className={`plugin-launcher-option${highlighted === index ? " active" : ""}`} disabled={busy}
          onPointerMove={() => setHighlighted(index)} onClick={() => void openPlugin(plugin)}>
          <span className="plugin-launcher-monogram" aria-hidden>{Array.from(plugin.name)[0]?.toLocaleUpperCase() ?? "P"}</span>
          <span className="plugin-launcher-option-copy"><strong>{plugin.name}</strong><span>{plugin.description || plugin.id}</span></span><ArrowUpRight size={15} aria-hidden />
        </button>) : <div className="plugin-launcher-empty" role="status"><Plug size={20} /><span>{query ? t("plugins.PluginLauncher.text_4daf11f436") : t("plugins.PluginLauncher.text_ea63107862")}</span></div>}
      </div><footer className="plugin-launcher-footer"><span>{t("plugins.PluginLauncher.text_1eee0ef18d")}</span><span>{t("plugins.PluginLauncher.text_61ba250145")}</span><span>{t("plugins.PluginLauncher.text_412bd6bd4b")}</span>{error || loadError ? <strong role="alert">{error || loadError}</strong> : null}</footer></div>
    </section>
  </div>;
}
