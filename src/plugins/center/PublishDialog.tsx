import { useEffect, useState } from "react";
import { usePluginsPage } from "./context";
import { Button, Textarea } from "./ui";
import { useModal } from "./useModal";
import { centerApi } from "./api";
import { pluginHost } from "../useDirectoryRegistry";
import { pluginError } from "../hostClient";
import { pluginNotice } from "../notices";
import { PermissionChips } from "./PermissionChips";
import type { PluginCheck } from "../runtimeContracts";

export function PublishDialog({ directory }: { directory: string }) {
  const { actions, data, market, setTab, setPublishDirectory } = usePluginsPage();
  const [checked, setChecked] = useState<PluginCheck | null>(null), [error, setError] = useState("");
  const [changelog, setChangelog] = useState("");
  const ref = useModal(() => setPublishDirectory(null), actions.busy);
  useEffect(() => {
    let live = true;
    void pluginHost.check(directory).then((value) => { if (live) setChecked(value); }).catch((reason) => { if (live) setError(pluginError(reason)); });
    return () => { live = false; };
  }, [directory]);
  const publish = () => actions.run(async () => {
    if (!checked) return;
    const result = await centerApi.publish({ directory, changelog, expectedDigest: checked.digest });
    const settings = { ...data.management.settings, pluginMarketSource: "personal" as const };
    await centerApi.setSource(settings); data.setManagement((current) => ({ ...current, settings }));
    setTab("market"); await market.refresh(true); setPublishDirectory(null);
    pluginNotice(`已发布 ${result.id} v${result.version} 到我的插件市场`);
  });
  return <div className="plugins-modal-backdrop" ref={ref}><div className="plugins-modal" role="dialog" aria-modal="true" aria-label="发布插件">
    <header className="plugins-modal-head"><div><h2 className="plugins-modal-title">发布到我的插件市场</h2>
      <p className="plugins-modal-subtitle">发布后可在本机安装，也可随市场网站一起分享。</p></div></header>
    <div className="plugins-modal-body">
      {checked ? <><h3 className="plugins-publish-name">{checked.manifest.name} <span>v{checked.manifest.version}</span></h3>
        <p className="plugins-author-hint">{checked.manifest.id} · {checked.fileCount} 个文件</p>
        <PermissionChips permissions={checked.manifest.permissions ?? []} />
        <label className="plugins-author-field"><span>更新说明</span><Textarea rows={3} maxLength={16_384} value={changelog} disabled={actions.busy}
          onChange={(event) => setChangelog(event.target.value)} placeholder="这个版本新增或改进了什么？" /></label>
        <p className="plugins-author-hint">同一版本发布后不可覆盖。修改代码后，请提升插件版本再发布。</p>
      </> : !error ? <p role="status">正在校验插件内容…</p> : null}
      {error || actions.error ? <p className="plugins-inline-error" role="alert">{error || actions.error}</p> : null}
    </div><footer className="plugins-modal-actions"><Button disabled={actions.busy} onClick={() => setPublishDirectory(null)}>取消</Button>
      <Button variant="primary" disabled={!checked || actions.busy} onClick={() => void publish()}>{actions.busy ? "正在发布…" : "发布插件"}</Button></footer>
  </div></div>;
}
