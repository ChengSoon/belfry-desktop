import { useState } from "react";
import type { DirectoryEntry, PluginOperation } from "./hostContracts";
import type { RuntimeCatalog } from "./runtimeContracts";
import { ManifestDetails } from "./PluginDetails";
import { PluginSettings } from "./PluginSettings";

interface CardProps {
  entry: DirectoryEntry; busy: boolean; runtime: RuntimeCatalog; onAction: (action: PluginOperation) => void;
  onAuthor: (action: "check" | "pack") => void; onPanel: () => void;
}
export function PluginCard(props: CardProps) {
  const { entry, busy, onAction } = props;
  const [removing, setRemoving] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
  const m = entry.manifest;
  const { ready, status, error } = cardState(props);
  const settings = m.runtime?.contributes?.settings;
  function act(action: PluginOperation) { setRemoving(false); onAction(action); }
  return <li><div className="plugins-panel__head"><div><h3>{m.name} <small>{m.version}</small></h3><p>{m.id} · {m.runtime ? "PI 插件" : "静态插件"}</p></div><span className={`plugins-badge ${ready ? "plugins-badge--enabled" : ""}`}>{status}</span></div>
    <p>{m.description}</p><ManifestDetails manifest={m} /><p className="plugins-path">{entry.source === "development" ? "开发目录" : "安装目录"}：{entry.sourcePath}</p>
    {error ? <p className="plugins-panel__error" role="alert">{error}</p> : null}
    <div className="plugins-actions"><button disabled={busy} onClick={() => act(entry.enabled ? "disable" : "enable")} type="button">{entry.enabled ? "禁用" : "启用"}</button><button disabled={busy} onClick={() => act("reload")} type="button">重载</button>
      <RuntimeActions {...props} ready={ready} />
      {settings?.length ? <button disabled={busy || !ready} aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)} type="button">插件设置</button> : null}
      <button disabled={busy} onClick={() => setRemoving(true)} type="button">卸载</button></div>
    {[settingsOpen, ready, settings].every(Boolean) ? <PluginSettings pluginId={m.id} settings={settings!} /> : null}
    {removing ? <RemoveConfirmation entry={entry} busy={busy} cancel={() => setRemoving(false)} confirm={() => act("uninstall")} /> : null}
  </li>;
}
function cardState({ entry, runtime }: CardProps) {
  const process = runtime.plugins.find((item) => item.id === entry.manifest.id);
  const error = entry.error ?? runtime.errors[entry.manifest.id];
  const ready = entry.enabled && (!entry.manifest.runtime || process?.status === "ready") && !error;
  const status = error ? "运行异常" : !entry.enabled ? "已禁用" : ready ? enabledLabel(entry) : "等待运行";
  return { ready, status, error };
}
function enabledLabel(entry: DirectoryEntry) { return entry.manifest.runtime ? "运行中" : "已启用"; }
function RuntimeActions({ entry, busy, runtime, ready, onPanel, onAuthor }: CardProps & { ready: boolean }) {
  if (!entry.manifest.runtime) return null;
  return <>
    {entry.manifest.runtime.ui?.panel ? <button disabled={busy || !ready} onClick={onPanel} type="button">打开面板</button> : null}
    <button disabled={busy || !runtime.available} onClick={() => onAuthor("check")} type="button">校验</button>
    <button disabled={busy || !runtime.available} onClick={() => onAuthor("pack")} type="button">打包</button>
  </>;
}
function RemoveConfirmation({ entry, busy, cancel, confirm }: Pick<CardProps, "entry" | "busy"> & { cancel: () => void; confirm: () => void }) {
  return <div className="plugins-remove" role="group" aria-label={`确认卸载 ${entry.manifest.name}`}>
    <p>卸载将停止插件并撤销贡献。{entry.source === "development" ? "开发目录会保留。" : "安装副本会删除，原始文件会保留。"}</p>
    <div className="plugins-actions"><button disabled={busy} onClick={cancel} type="button">取消</button>
      <button disabled={busy} onClick={confirm} type="button">确认卸载</button></div>
  </div>;
}
