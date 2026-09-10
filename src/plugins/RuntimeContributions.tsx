import { useState } from "react";
import type { RuntimeCatalog } from "./runtimeContracts";
import { pluginHost } from "./useDirectoryRegistry";
import { pluginError } from "./hostClient";
import { localizedText } from "./runtimeCatalog";
import { PluginThemes } from "./PluginThemes";

export function RuntimeContributions({ runtime }: { runtime: RuntimeCatalog }) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  async function run(operation: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setNotice("");
    try { const result = await operation(); setNotice(result == null ? "执行完成" : JSON.stringify(result, null, 2)); }
    catch (error) { setNotice(pluginError(error)); } finally { setBusy(false); }
  }
  if (![runtime.commands, runtime.tools, runtime.skills, runtime.views, runtime.services, runtime.themes].some((items) => items.length)) return null;
  return <section className="plugins-contributions" aria-label="运行中的插件贡献"><h3>运行中的贡献</h3>
    <PluginThemes themes={runtime.themes} />
    {runtime.commands.map((item) => <article key={`${item.pluginId}:${item.id}`}><div><strong>{item.title}</strong><small>{item.pluginName} · 命令</small></div><button disabled={busy} onClick={() => void run(() => pluginHost.runCommand(item.pluginId, item.id))} type="button">运行命令</button></article>)}
    {runtime.views.map((item) => <article key={`${item.pluginId}:view:${item.id}`}><div><strong>{localizedText(item.title, item.id)}</strong><small>{item.pluginName} · 视图</small></div><button disabled={busy} onClick={() => void run(() => pluginHost.openPanel(item.pluginId, item.id))} type="button">打开视图</button></article>)}
    {runtime.tools.length || runtime.skills.length ? <p>工具和 Skill 可供新开的 Codex / Claude 会话使用。已打开的会话请重新启动后连接。</p> : null}
    {runtime.tools.map((item) => <article key={`${item.pluginId}:tool:${item.name}`}><div><strong>{item.name}</strong><small>{item.pluginName} · Agent 工具</small><p>{item.description}</p></div><span className="plugins-badge">已注册</span></article>)}
    {runtime.skills.map((item) => <article key={`${item.pluginId}:skill:${item.id}`}><div><strong>{item.name}</strong><small>{item.pluginName} · Skill</small><p>{item.description}</p></div><button disabled={busy} onClick={() => void run(async () => {
      const text = await pluginHost.requestRuntime<string>("skill", { pluginId: item.pluginId, path: item.path });
      await navigator.clipboard.writeText(text); return "Skill 已复制";
    })} type="button">复制 Skill</button></article>)}
    {runtime.services.map((item) => <article key={`${item.pluginId}:service:${item.id}`}><div><strong>{item.label ?? item.id}</strong><small>{item.pluginName} · 后台服务</small></div><span className="plugins-badge plugins-badge--enabled">{item.status === "running" ? "运行中" : item.status}</span></article>)}
    <pre role="status">{notice}</pre>
  </section>;
}
