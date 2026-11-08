import { useFeedback, t, useTranslation } from "../../i18n";
import { ArrowUp, Folder } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SshTarget } from "../../terminal/contracts";
import type { RemoteReport } from "./contracts";
import { cleanTarget } from "./model";
import { createProbeController } from "./probeController";
import { message } from "./storage";

interface Props { target: SshTarget; path: string; onChange: (path: string) => void }

export function RemoteDirectory({ target, path, onChange }: Props) {
  useTranslation();
  const probe = useRemoteProbe();
  const run = (browse: boolean, directory = path) => void probe.run({ ...target, remotePath: directory || null }, browse);
  return <div className="ssh-remote">
    <label className="ssh-form__field"><span>{t("workspace.RemoteDirectory.text_b67492268d")}</span><input aria-label={t("workspace.RemoteDirectory.text_5f5f0fd7d8")} placeholder={t("workspace.RemoteDirectory.text_77d84a8691")}
      value={path} disabled={probe.busy} maxLength={4_096} onChange={(event) => { probe.reset(); onChange(event.target.value); }} /></label>
    <div className="ssh-remote__actions"><button type="button" className="ssh-link" disabled={probe.busy} onClick={() => run(false)}>{t("workspace.RemoteDirectory.text_abc2fba0ed")}</button>
      <button type="button" className="ssh-link" disabled={probe.busy} onClick={() => run(true)}>{t("workspace.RemoteDirectory.text_c01ee4f065")}</button>
      {probe.busy ? <button type="button" className="ssh-link" onClick={probe.cancel}>{t("workspace.RemoteDirectory.text_6f88b3b88f")}</button> : null}</div>
    <p className="ssh-note">{t("workspace.RemoteDirectory.text_f60a96bd07")}</p>
    {probe.busy ? <p className="ssh-note" role="status">{t("workspace.RemoteDirectory.text_ee9ebe523d")}</p> : null}
    {probe.error ? <p className="ssh-form__error ssh-remote__error" role="alert">{probe.error}</p> : null}
    {probe.report ? <RemoteResult report={probe.report} browse={probe.browse} onNavigate={(path) => run(true, path)} onChoose={onChange} /> : null}
  </div>;
}

function useRemoteProbe() {
  useTranslation();
  const controller = useRef(createProbeController()); const version = useRef(0);
  const [busy, setBusy] = useState(false), [browse, setBrowse] = useState(false);
  const [report, setReport] = useState<RemoteReport | null>(null), [error, setError] = useFeedback<string | null>(null);
  const cancel = () => { version.current++; controller.current.cancel(); setBusy(false); setError(() => t("workspace.RemoteDirectory.text_282c4cfbc8")); };
  const reset = () => { version.current++; controller.current.cancel(); setBusy(false); setError(null); setReport(null); };
  useEffect(() => () => { version.current++; controller.current.cancel(); }, []);
  const run = async (target: SshTarget, browse: boolean) => {
    const current = ++version.current; setBusy(true); setReport(null); setError(null); setBrowse(browse);
    try {
      const result = await controller.current.run(cleanTarget(target), browse);
      if (version.current === current) setReport(result);
    } catch (error) { if (version.current === current) setError(() => message(error)); }
    finally { if (version.current === current) setBusy(false); }
  };
  return { busy, browse, report, error, run, cancel, reset };
}

function RemoteResult({ report, browse, onNavigate, onChoose }: {
  report: RemoteReport; browse: boolean; onNavigate: (path: string) => void; onChoose: (path: string) => void;
}) {
  useTranslation();
  const parent = report.path.slice(0, report.path.lastIndexOf("/")) || "/";
  return <div className="ssh-remote__result" aria-label={t("workspace.RemoteDirectory.text_c260e5a135")}>
    <div className="ssh-remote__result-head"><span role="status">{t("workspace.RemoteDirectory.text_da0bfef256")}</span><button type="button" onClick={() => onChoose(report.path)}>{t("workspace.RemoteDirectory.text_463099fe90")}</button></div>
    <p className="ssh-remote__path" title={report.path}>{report.path}</p>
    {browse ? <nav aria-label={t("workspace.RemoteDirectory.text_63eae09fb5")}><button type="button" disabled={report.path === "/"} onClick={() => onNavigate(parent)}><ArrowUp size={14} />{t("workspace.RemoteDirectory.text_963f3b5d1c")}</button>
      {report.directories.map((name) => <button type="button" key={name} title={name} onClick={() => onNavigate(`${report.path.replace(/\/$/, "")}/${name}`)}>
        <Folder size={14} /><span>{name}</span></button>)}
      {!report.directories.length ? <p className="ssh-note">{t("workspace.RemoteDirectory.text_46bfe568c7")}</p> : null}</nav> : null}
    {report.truncated ? <p className="ssh-note">{t("workspace.RemoteDirectory.text_357c0d35ab")}</p> : null}
  </div>;
}
