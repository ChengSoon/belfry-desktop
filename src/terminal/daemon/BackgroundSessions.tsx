import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Moon, RefreshCw } from "lucide-react";
import type { TerminalSession } from "../contracts";
import { closeTerminal } from "../api";
import { errorMessage } from "../terminalController";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import "./daemon.css";

interface BackgroundSession { session: TerminalSession; tabId: string | null; profileId: string }

export function BackgroundSessions() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<BackgroundSession[]>([]);
  const [pending, setPending] = useState<BackgroundSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setBusy(true); setError(null);
    void invoke<BackgroundSession[]>("terminal_background_sessions").then(setEntries)
      .catch((error) => setError(errorMessage(error))).finally(() => setBusy(false));
  };
  const end = () => {
    if (!pending) return;
    const id = pending.session.id; setPending(null); setBusy(true);
    void closeTerminal(id).then(refresh).catch((error) => { setError(errorMessage(error)); setBusy(false); });
  };
  return <section className="background-sessions">
    <button className="background-sessions__toggle" type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) refresh(); }}>
      <Moon size={16} /> 后台任务 <ChevronDown size={14} />
    </button>
    {open ? <>
      <p>查看此应用保留的终端，包括当前工作区以外的任务。</p>
      <button className="daemon-button" type="button" disabled={busy} onClick={refresh}><RefreshCw size={14} />刷新</button>
      {error ? <p role="alert">{error}</p> : null}
      {!entries.length && !busy ? <p>没有保留的后台任务。</p> : null}
      <ul className="background-sessions__list">{entries.map((entry) => <li key={entry.session.id}>
        <div><strong>{entry.session.shell}</strong> · {entry.session.status === "running" ? "运行中" : "已退出"}<small>{entry.session.cwd}</small></div>
        <button className="daemon-button" type="button" disabled={busy} onClick={() => setPending(entry)}>{entry.session.status === "running" ? "结束" : "清除"}</button>
      </li>)}</ul>
    </> : null}
    {pending ? <ConfirmDialog title="结束这条后台会话？" body="对应进程会结束，保留的终端输出也会清除。" confirmLabel="结束会话" onConfirm={end} onCancel={() => setPending(null)} /> : null}
  </section>;
}
