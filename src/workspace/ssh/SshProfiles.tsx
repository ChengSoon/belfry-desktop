import { useEffect, useRef, useState } from "react";
import { Select } from "../../components/controls/Select";
import { Combobox } from "../../components/controls/Combobox";
import { Disclosure } from "../../components/controls/Disclosure";
import { readAliases } from "./api";
import type { AliasReport } from "./contracts";
import { message } from "./storage";
import type { SshFormState } from "./useSshForm";

export function SshProfiles({ state }: { state: SshFormState }) {
  const sorted = [...state.hosts.catalog.entries].sort((a, b) => a.group.localeCompare(b.group, "zh-CN") || a.name.localeCompare(b.name, "zh-CN"));
  return <div className="ssh-profiles">
    <label className="ssh-form__field"><span>主机档案</span><Select ariaLabel="选择 SSH 主机档案" value={state.selected?.id ?? ""}
      options={[{ value: "", label: "临时连接" }, ...sorted.map((item) => ({ value: item.id, label: item.group ? `${item.group} · ${item.name}` : item.name,
        description: `${item.target.host}${item.target.remotePath ?? ""}` }))]}
      onChange={(id) => state.select(state.hosts.catalog.entries.find((item) => item.id === id) ?? null)} /></label>
    <AliasPicker onSelect={state.alias} />
  </div>;
}

function AliasPicker({ onSelect }: { onSelect: (name: string) => void }) {
  const [report, setReport] = useState<AliasReport | null>(null), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const load = async () => {
    setBusy(true); setError(null);
    try { const result = await readAliases(); if (active.current) setReport(result); }
    catch (error) { if (active.current) setError(message(error)); }
    finally { if (active.current) setBusy(false); }
  };
  return <div className="ssh-aliases">
    <button type="button" className="ssh-link" disabled={busy} onClick={() => void load()}>{busy ? "读取中…" : "从 SSH 配置选择别名"}</button>
    {report ? <><Select ariaLabel="SSH 配置别名" value="" options={[{ value: "", label: "选择别名…", disabled: true },
      ...report.aliases.map((alias) => ({ value: alias.name, label: alias.name, description: alias.source }))]} onChange={onSelect} />
      {!report.aliases.length ? <p className="ssh-note">没有可导入的明确别名，可直接输入主机。</p> : null}
      {report.warnings.length ? <Disclosure title="部分配置未导入">{report.warnings.map((warning) => <p className="ssh-note" key={warning}>{warning}</p>)}</Disclosure> : null}</> : null}
    {error ? <p className="ssh-form__error" role="alert">{error}</p> : null}
  </div>;
}

export function SaveHost({ state }: { state: SshFormState }) {
  const groups = [...new Set(state.hosts.catalog.entries.map((item) => item.group).filter(Boolean))];
  return <Disclosure title={state.selected ? "更新主机档案" : "保存为主机档案"} className="ssh-section">
    <div className="ssh-form__row"><label className="ssh-form__field"><span>名称</span><input aria-label="SSH 档案名称"
      value={state.name} maxLength={100} placeholder={state.fields.host || "例如开发服务器"} onChange={(event) => state.setName(event.target.value)} /></label>
      <label className="ssh-form__field"><span>分组</span><Combobox ariaLabel="SSH 主机分组" value={state.group} maxLength={80}
        onChange={state.setGroup} options={groups.map((value) => ({ value, label: value }))} placeholder="不分组" /></label></div>
    <p className="ssh-note">保存连接目标和远端目录，密码继续留在系统凭据库。</p>
    <button className="ssh-link" type="button" onClick={state.save}>保存主机档案</button>
  </Disclosure>;
}
