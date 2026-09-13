import { useState } from "react";
import { removeSshCredentials } from "../../terminal/api";
import type { SshTarget } from "../../terminal/contracts";
import type { HostProfile } from "./contracts";
import { cleanTarget } from "./model";
import { message } from "./storage";
import { parseSshTarget, type SshFields } from "./target";
import { useHosts } from "./useHosts";

export function useSshForm(initial?: SshTarget | null, remember = true) {
  const hosts = useHosts();
  const [fields, setFields] = useState(() => fieldsFor(initial, remember));
  const [selected, setSelected] = useState<HostProfile | null>(null);
  const [name, setName] = useState(""); const [group, setGroup] = useState("");
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const select = (profile: HostProfile | null) => {
    setSelected(profile); setFields(fieldsFor(profile?.target, remember));
    setName(profile?.name ?? ""); setGroup(profile?.group ?? ""); setError(null); setNotice(null);
  };
  const alias = (host: string) => {
    select(null); setFields(fieldsFor({ host, user: null, port: null }, remember)); setName(host);
  };
  const save = () => {
    setError(null); setNotice(null);
    try {
      const current = hosts.catalog.entries.find((item) => item.id === selected?.id);
      if (selected && JSON.stringify(current) !== JSON.stringify(selected)) throw new Error("此主机已在其他窗口修改，请重新选择后编辑");
      const entry = { id: selected?.id ?? crypto.randomUUID(), name: name.trim() || fields.host.trim(), group,
        target: cleanTarget(fields) };
      const saved = hosts.save(entry); setSelected(saved); setName(saved.name); setGroup(saved.group);
      setNotice("主机档案已保存，连接时使用当前参数");
    } catch (error) { setError(message(error)); }
  };
  const clear = async () => {
    setError(null); setNotice(null); setClearing(true);
    try { await removeSshCredentials(cleanTarget(fields)); setNotice("此主机的已保存密码已清除"); }
    catch (error) { setError(message(error)); }
    finally { setClearing(false); }
  };
  const parse = () => { const target = parseSshTarget(fields); if (typeof target === "string") { setError(target); return null; } return target; };
  const update = (patch: Partial<SshFields>) => { setFields((current) => ({ ...current, ...patch })); setError(null); setNotice(null); };
  return { fields, update, selected, select, alias, name, setName, group, setGroup, error: error ?? hosts.error, notice,
    clearing, clear, save, parse, hosts };
}

function fieldsFor(target?: SshTarget | null, remember = true): SshFields {
  return { host: target?.host ?? "", user: target?.user ?? "", port: target?.port?.toString() ?? "",
    remotePath: target?.remotePath ?? "", password: "", remember };
}

export type SshFormState = ReturnType<typeof useSshForm>;
