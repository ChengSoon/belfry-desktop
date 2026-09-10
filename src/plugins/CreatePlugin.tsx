import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { PluginTemplate, ScaffoldInput } from "./runtimeContracts";
import { pluginError } from "./hostClient";

const TEMPLATES: { id: PluginTemplate; title: string; description: string }[] = [
  { id: "panel-basic", title: "界面面板", description: "自定义 HTML 界面与打开命令" },
  { id: "agent-tool-basic", title: "Agent 工具", description: "让 Agent 调用你的 JavaScript 函数" },
  { id: "skill-pack", title: "Skill 技能包", description: "把工作方法提供给 Agent" },
  { id: "full-demo", title: "完整示例", description: "面板、工具、Skill 与可编辑设置" },
];
export function CreatePlugin({ busy, onCreate, onCancel }: { busy: boolean; onCreate: (input: ScaffoldInput) => Promise<void>; onCancel: () => void }) {
  const [template, setTemplate] = useState<PluginTemplate>("panel-basic");
  const [name, setName] = useState("我的插件"), [id, setId] = useState("local.my-plugin");
  const [parent, setParent] = useState(""), [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const locked = busy || choosing;
  async function choose() {
    setChoosing(true); setError("");
    try { const path = await open({ directory: true, multiple: false, title: "选择新插件的父目录" }); if (typeof path === "string") setParent(path); }
    catch (reason) { setError(pluginError(reason)); } finally { setChoosing(false); }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!parent || locked) return;
    const separator = parent.includes("\\") ? "\\" : "/";
    void onCreate({ directory: `${parent.replace(/[\\/]$/, "")}${separator}${id}`, template, id, name });
  }
  return <form className="plugins-create" onSubmit={submit} aria-label="从模板新建插件">
    <div><span className="plugins-eyebrow">插件作者工具</span><h3>从模板开始</h3><p>自动生成 manifest.json、入口代码与示例资源。创建后可直接加载和修改。</p></div>
    <fieldset disabled={locked}><legend>选择模板</legend><div className="plugins-templates">{TEMPLATES.map((item) => <label key={item.id} className={item.id === template ? "is-selected" : ""}>
      <input type="radio" name="plugin-template" value={item.id} checked={item.id === template} onChange={() => setTemplate(item.id)} /><span><strong>{item.title}</strong><small>{item.description}</small></span>
    </label>)}</div></fieldset>
    <div className="plugins-form-row"><label>插件名称<input value={name} disabled={locked} onChange={(event) => setName(event.target.value)} required maxLength={128} /></label>
      <label>插件 ID<input value={id} disabled={locked} onChange={(event) => setId(event.target.value)} required pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*" maxLength={128} /></label></div>
    <div className="plugins-folder"><button disabled={locked} onClick={() => void choose()} type="button">选择保存位置</button><span className="plugins-path">{parent ? `${parent} / ${id}` : "将在所选位置新建插件目录"}</span></div>
    {error ? <p role="alert" className="plugins-panel__error">{error}</p> : null}
    <div className="plugins-actions"><button disabled={locked} onClick={onCancel} type="button">取消</button><button className="plugins-primary" disabled={locked || !parent || !name.trim() || !id.trim()} type="submit">创建并预览</button></div>
  </form>;
}
