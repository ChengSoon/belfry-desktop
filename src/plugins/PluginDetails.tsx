import type { DirectoryManifest, InstallPreview } from "./hostContracts";
export function ManifestDetails({ manifest }: { manifest: DirectoryManifest }) {
  const c = manifest.contributes;
  const runtime = manifest.runtime?.contributes;
  const extra = [[runtime?.agentTools, "工具"], [runtime?.views, "视图"], [runtime?.themes, "主题"],
    [runtime?.services, "服务"], [runtime?.mcpServers, "MCP 服务"]] as const;
  return <dl className="plugins-details">
    <dt>作者</dt><dd>{manifest.author || "未提供"}</dd>
    <dt>兼容</dt><dd>{manifest.runtime ? `PI 插件 API · ${manifest.runtime.engines?.piDesktop ?? "schemaVersion 1"}` : <>应用 ≥ {manifest.compatibility.minAppVersion}{manifest.compatibility.maxAppVersionExclusive ? `，< ${manifest.compatibility.maxAppVersionExclusive}` : ""} · API {manifest.compatibility.pluginApi}</>}</dd>
    <dt>权限</dt><dd>{manifest.permissions.join(" · ") || "无"}</dd>
    <dt>贡献</dt><dd>{c.commands.length} 命令 · {c.skills.length} Skills · {c.settings.length} 设置{extra.filter(([items]) => items?.length).map(([items, label]) => ` · ${items!.length} 个${label}`).join("")}</dd>
    {manifest.runtime?.fs ? <><dt>文件</dt><dd>{Object.entries(manifest.runtime.fs).map(([mode, rule]) => `${mode}：${rule.root ?? "workspace"} / ${rule.scope?.join("、") || "无"}`).join("；")}</dd></> : null}
    {manifest.runtime?.net?.domains ? <><dt>网络</dt><dd>{manifest.runtime.net.domains.join("、")}</dd></> : null}
  </dl>;
}
export function PreviewCard({ preview, busy, canInstall, onConfirm, onCancel }: { preview: InstallPreview; busy: boolean; canInstall: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <section className="plugins-preview" aria-labelledby="plugin-preview-title">
    <div className="plugins-panel__head"><div><span className="plugins-eyebrow">安装预览 · 待确认安装</span><h3 id="plugin-preview-title">{preview.manifest.name} <small>{preview.manifest.version}</small></h3></div><span className="plugins-badge">{preview.development ? "开发目录" : "受管安装"}</span></div>
    <p>{preview.manifest.description}</p><ManifestDetails manifest={preview.manifest} />
    <p className="plugins-path">来源：{preview.sourcePath}</p>
    <p>{preview.fileCount} 个文件 · {Math.ceil(preview.totalBytes / 1024)} KB · 已通过兼容与路径校验</p>
    <p>{preview.development ? "引用原目录；代码修改后自动重载，清单修改后需要核对。" : "复制到应用安装目录。"}安装后默认禁用。</p>
    {preview.manifest.runtime ? <p>启用后会运行插件的 JavaScript 代码。插件可使用 Node.js 原生能力，请只安装可信来源。</p> : null}
    <div className="plugins-actions"><button disabled={busy} onClick={onCancel} type="button">取消</button><button className="plugins-primary" disabled={busy || !canInstall} onClick={onConfirm} type="button">确认权限并安装</button></div>
  </section>;
}
