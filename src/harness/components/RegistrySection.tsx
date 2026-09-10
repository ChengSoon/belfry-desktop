import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HarnessRegistryClient, type HarnessInstallPreview, type HarnessPlugin, type HarnessRegistryState } from "../registryClient";
import "./registrySection.css";

const APP_VERSION = "0.19.0";
export type RegistryAction = "disable" | "uninstall";

export function RegistrySection({ client = new HarnessRegistryClient() }: { client?: HarnessRegistryClient }) {
  const [registry, setRegistry] = useState<HarnessRegistryState | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [preview, setPreview] = useState<HarnessInstallPreview>();
  const load = useCallback(async () => {
    setError(undefined);
    try { setRegistry(await client.list()); }
    catch { setError("系统 Harness Registry 暂时不可用"); }
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  const mutate = async (action: RegistryAction, plugin: HarnessPlugin) => {
    if (!registry || !globalThis.confirm(confirmText(action, plugin.pluginId))) return;
    setBusy(plugin.pluginId); setError(undefined);
    try {
      const next = action === "disable"
        ? await client.disable(registry.revision, plugin.pluginId)
        : await client.uninstall(registry.revision, plugin.pluginId);
      setRegistry(next);
    } catch (failure) {
      setError(isRevisionConflict(failure) ? "Registry 已在其他窗口更新，列表已重新读取" : "Registry 操作失败，请重试");
      if (isRevisionConflict(failure)) await load();
    } finally { setBusy(undefined); }
  };

  const plugins = useMemo(() => registry?.plugins ?? [], [registry]);
  const selectImport = async () => {
    const manifestPath = await openDialog({ multiple: false, directory: false, filters: [{ name: "Harness manifest", extensions: ["json"] }] });
    if (typeof manifestPath !== "string") return;
    const workerPath = await openDialog({ multiple: false, directory: false, title: "选择 Harness Worker" });
    if (typeof workerPath !== "string") return;
    setBusy("install"); setError(undefined);
    try { setPreview(await client.previewInstall(manifestPath, workerPath)); }
    catch { setError("本地 Harness 校验失败；未安装任何文件"); }
    finally { setBusy(undefined); }
  };
  const finishImport = async (approve: boolean) => {
    if (!preview) return;
    const selected = preview; setPreview(undefined); setBusy("install");
    try {
      if (approve) setRegistry(await client.commitInstall(selected.previewId));
      else await client.cancelInstall(selected.previewId);
    } catch (failure) {
      setError(isRevisionConflict(failure) ? "Registry 已在其他窗口更新，安装未提交" : "安装事务失败；未留下部分安装");
      await load();
    } finally { setBusy(undefined); }
  };
  return (
    <section aria-labelledby="harness-registry-title" className="harness-registry">
      <header className="harness-registry__head">
        <div><h2 id="harness-registry-title">Harness Registry</h2><p>系统级安装记录与会话能力来源</p></div>
        <div className="harness-registry__actions"><button disabled={Boolean(busy)} onClick={() => void selectImport()} type="button">本地导入</button><button aria-label="刷新 Harness Registry" disabled={Boolean(busy)} onClick={() => void load()} type="button"><RefreshCw aria-hidden="true" size={14} />刷新</button></div>
      </header>
      <aside className="harness-registry__notice"><ShieldCheck aria-hidden="true" size={16} /><span><strong>如何使用：</strong>① 依次选择 manifest 和 Worker；② 检查版本、能力、digest 与未签名警告；③ 二次确认安装；④ 在新建会话菜单选择 Codex/Claude · Harness。目标路径、trusted、executable 与 argv 均由宿主管理。</span></aside>
      <div aria-live="polite" className="harness-registry__meta">Revision <code>{registry?.revision ?? "—"}</code></div>
      {error ? <p className="harness-registry__error" role="alert">{error}</p> : null}
      {preview ? <aside className="harness-registry__preview" aria-label="安装预览">
        <strong>{preview.pluginId} v{preview.version}</strong>
        <p>来源：本机明确选择 · 能力：{preview.capabilities.join(" · ") || "无"}</p>
        <p>Worker digest：<code>{preview.workerDigest}</code></p>
        <p className="harness-registry__warning">未验证发布者签名；仅标记为本地用户批准并完成内容完整性检查。</p>
        <div className="harness-registry__actions"><button onClick={() => void finishImport(false)} type="button">取消</button><button onClick={() => void finishImport(true)} type="button">确认安装</button></div>
      </aside> : null}
      {!registry && !error ? <p className="harness-registry__empty">正在读取系统 Registry…</p> : null}
      {registry && plugins.length === 0 ? <p className="harness-registry__empty">尚无本地批准的 Harness。请在上方依次选择 manifest 和 Worker 导入；安装成功后到新建会话菜单选择 Codex/Claude · Harness。</p> : null}
      {plugins.length ? <ul className="harness-registry__list">{plugins.map((plugin) => {
        const status = pluginStatus(plugin);
        return <li key={plugin.pluginId}>
          <div className="harness-registry__identity"><strong>{plugin.pluginId}</strong><span>v{plugin.version}</span></div>
          <div className="harness-registry__badges"><span data-tone={status.trusted ? "ok" : "warn"}>{status.trusted ? "受信" : "未受信"}</span><span data-tone={status.compatible ? "ok" : "warn"}>{status.compatible ? "兼容" : "不兼容"}</span><span>{status.enabled ? "已启用" : "已禁用"}</span></div>
          <p>{plugin.capabilities.length ? plugin.capabilities.join(" · ") : "未声明能力"}</p>
          <div className="harness-registry__actions"><button disabled title="产品安装入口待信任链" type="button">更新</button><button disabled={!plugin.enabled || busy === plugin.pluginId} onClick={() => void mutate("disable", plugin)} type="button">禁用</button><button disabled={busy === plugin.pluginId} onClick={() => void mutate("uninstall", plugin)} type="button">卸载</button></div>
        </li>;
      })}</ul> : null}
    </section>
  );
}

export function pluginStatus(plugin: HarnessPlugin) {
  return { trusted: plugin.trusted, enabled: plugin.enabled, compatible: plugin.harnessApi === 1 && compareVersions(plugin.minAppVersion, APP_VERSION) <= 0 };
}
export function isRevisionConflict(value: unknown) { return typeof value === "object" && value !== null && "code" in value && value.code === "REVISION_CONFLICT"; }
export function confirmText(action: RegistryAction, pluginId: string) { return action === "disable" ? `禁用 ${pluginId}？新会话将无法选择它。` : `卸载 ${pluginId}？已有会话仅保留历史快照。`; }
function compareVersions(left: string, right: string) { const a = left.split(".").map(Number); const b = right.split(".").map(Number); for (let i = 0; i < 3; i += 1) { if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0); } return 0; }
