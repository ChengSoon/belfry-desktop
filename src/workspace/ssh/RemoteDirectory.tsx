import { ArrowUp, Folder } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SshTarget } from "../../terminal/contracts";
import type { RemoteReport } from "./contracts";
import { cleanTarget } from "./model";
import { createProbeController } from "./probeController";
import { message } from "./storage";

interface Props { target: SshTarget; path: string; onChange: (path: string) => void }

export function RemoteDirectory({ target, path, onChange }: Props) {
  const probe = useRemoteProbe();
  const run = (browse: boolean, directory = path) => void probe.run({ ...target, remotePath: directory || null }, browse);
  return <div className="ssh-remote">
    <label className="ssh-form__field"><span>远端项目目录（可选）</span><input aria-label="SSH 远端目录" placeholder="例如 /home/me/project"
      value={path} disabled={probe.busy} maxLength={4_096} onChange={(event) => { probe.reset(); onChange(event.target.value); }} /></label>
    <div className="ssh-remote__actions"><button type="button" className="ssh-link" disabled={probe.busy} onClick={() => run(false)}>诊断连接</button>
      <button type="button" className="ssh-link" disabled={probe.busy} onClick={() => run(true)}>浏览远端目录</button>
      {probe.busy ? <button type="button" className="ssh-link" onClick={probe.cancel}>取消请求</button> : null}</div>
    <p className="ssh-note">继承 SSH 别名、跳板机和密钥。浏览使用免交互认证，远端目录不会作为本机目录读取。</p>
    {probe.busy ? <p className="ssh-note" role="status">连接中…</p> : null}
    {probe.error ? <p className="ssh-form__error ssh-remote__error" role="alert">{probe.error}</p> : null}
    {probe.report ? <RemoteResult report={probe.report} browse={probe.browse} onNavigate={(path) => run(true, path)} onChoose={onChange} /> : null}
  </div>;
}

function useRemoteProbe() {
  const controller = useRef(createProbeController()); const version = useRef(0);
  const [busy, setBusy] = useState(false), [browse, setBrowse] = useState(false);
  const [report, setReport] = useState<RemoteReport | null>(null), [error, setError] = useState<string | null>(null);
  const cancel = () => { version.current++; controller.current.cancel(); setBusy(false); setError("请求已取消"); };
  const reset = () => { version.current++; controller.current.cancel(); setBusy(false); setError(null); setReport(null); };
  useEffect(() => () => { version.current++; controller.current.cancel(); }, []);
  const run = async (target: SshTarget, browse: boolean) => {
    const current = ++version.current; setBusy(true); setReport(null); setError(null); setBrowse(browse);
    try {
      const result = await controller.current.run(cleanTarget(target), browse);
      if (version.current === current) setReport(result);
    } catch (error) { if (version.current === current) setError(message(error)); }
    finally { if (version.current === current) setBusy(false); }
  };
  return { busy, browse, report, error, run, cancel, reset };
}

function RemoteResult({ report, browse, onNavigate, onChoose }: {
  report: RemoteReport; browse: boolean; onNavigate: (path: string) => void; onChoose: (path: string) => void;
}) {
  const parent = report.path.slice(0, report.path.lastIndexOf("/")) || "/";
  return <div className="ssh-remote__result" aria-label="远端目录结果">
    <div className="ssh-remote__result-head"><span role="status">连接正常</span><button type="button" onClick={() => onChoose(report.path)}>使用此目录</button></div>
    <p className="ssh-remote__path" title={report.path}>{report.path}</p>
    {browse ? <nav aria-label="远端子目录"><button type="button" disabled={report.path === "/"} onClick={() => onNavigate(parent)}><ArrowUp size={14} />上级目录</button>
      {report.directories.map((name) => <button type="button" key={name} title={name} onClick={() => onNavigate(`${report.path.replace(/\/$/, "")}/${name}`)}>
        <Folder size={14} /><span>{name}</span></button>)}
      {!report.directories.length ? <p className="ssh-note">此目录没有子目录</p> : null}</nav> : null}
    {report.truncated ? <p className="ssh-note">仅显示前 200 个目录，可输入完整路径继续浏览。</p> : null}
  </div>;
}
