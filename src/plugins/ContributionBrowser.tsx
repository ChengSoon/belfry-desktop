import { useState } from "react";
import type { DirectoryRegistry } from "./hostContracts";
import { pluginHost } from "./useDirectoryRegistry";
import { pluginError } from "./hostClient";
import { staticCatalog } from "./staticCatalog";
export function ContributionBrowser({ registry }: { registry: DirectoryRegistry | null }) {
  const catalog = staticCatalog(registry);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function copy(pluginId: string, id: string, kind: "command" | "skill") {
    if (busy) return; setBusy(true);
    try {
      const fresh = await pluginHost.list();
      const current = staticCatalog(fresh);
      const text = kind === "skill" ? await pluginHost.skill(pluginId, id) : current.commands.find((c) => c.pluginId === pluginId && c.id === id)?.text;
      if (text === undefined) throw new Error("贡献已撤销，请刷新");
      await navigator.clipboard.writeText(text); setNotice("已复制；可粘贴到 Agent 输入区确认发送。");
    } catch (reason) { setNotice(pluginError(reason)); } finally { setBusy(false); }
  }
  if (!Object.values(catalog).some((items) => items.length)) return null;
  return <section className="plugins-contributions" aria-label="已启用贡献">
    <h3>已启用贡献</h3><p>静态命令与 Skill 可复制到 Agent；设置贡献展示默认值。</p>
    {catalog.commands.map((item) => <article key={item.key}><div><strong>{item.title}</strong><small>{item.pluginName} · 命令</small><pre>{item.text}</pre></div><button disabled={busy} onClick={() => void copy(item.pluginId, item.id, "command")} type="button">复制命令</button></article>)}
    {catalog.skills.map((item) => <article key={item.key}><div><strong>{item.title}</strong><small>{item.pluginName} · Skill</small></div><button disabled={busy} onClick={() => void copy(item.pluginId, item.id, "skill")} type="button">复制 Skill</button></article>)}
    {catalog.settings.map((item) => <article key={item.key}><div><strong>{item.title}</strong><small>{item.pluginName} · 静态设置默认值</small><p>{item.description}</p></div><code>{item.default}</code></article>)}
    <p role="status">{notice}</p>
  </section>;
}
