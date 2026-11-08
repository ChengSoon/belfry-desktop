import { useFeedback, t, useTranslation } from "../../i18n";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Moon, RefreshCw } from "lucide-react";
import type { TerminalSession } from "../contracts";
import { closeTerminal } from "../api";
import { errorMessage } from "../terminalController";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Presence } from "../../components/motion/Presence";
import "./daemon.css";

interface BackgroundSession { session: TerminalSession; tabId: string | null; profileId: string }

export function BackgroundSessions() {
  useTranslation();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<BackgroundSession[]>([]);
  const [pending, setPending] = useState<BackgroundSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedback<string | null>(null);
  const refresh = () => {
    setBusy(true); setError(null);
    void invoke<BackgroundSession[]>("terminal_background_sessions").then(setEntries)
      .catch((error) => setError(() => errorMessage(error))).finally(() => setBusy(false));
  };
  const end = () => {
    if (!pending) return;
    const id = pending.session.id; setPending(null); setBusy(true);
    void closeTerminal(id).then(refresh).catch((error) => { setError(() => errorMessage(error)); setBusy(false); });
  };
  return <section className="background-sessions">
    <button className="background-sessions__toggle" type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) refresh(); }}>
      <Moon size={16} />{t("terminal.BackgroundSessions.text_4c46c90439")}<ChevronDown size={14} />
    </button>
    {open ? <>
      <p>{t("terminal.BackgroundSessions.text_59141671b0")}</p>
      <button className="daemon-button" type="button" disabled={busy} onClick={refresh}><RefreshCw size={14} />{t("terminal.BackgroundSessions.text_aee8874341")}</button>
      {error ? <p role="alert">{error}</p> : null}
      {!entries.length && !busy ? <p>{t("terminal.BackgroundSessions.text_68b47478de")}</p> : null}
      <ul className="background-sessions__list">{entries.map((entry) => <li key={entry.session.id}>
        <div><strong>{entry.session.shell}</strong> · {entry.session.status === "running" ? t("terminal.BackgroundSessions.text_1f0eb99b7e") : t("terminal.BackgroundSessions.text_899df7e244")}<small>{entry.session.cwd}</small></div>
        <button className="daemon-button" type="button" disabled={busy} onClick={() => setPending(entry)}>{entry.session.status === "running" ? t("terminal.BackgroundSessions.text_c7b24e7997") : t("terminal.BackgroundSessions.text_bce2377283")}</button>
      </li>)}</ul>
    </> : null}
    <Presence open={!!pending}>
    {pending ? <ConfirmDialog title={t("terminal.BackgroundSessions.text_109157c118")} body={t("terminal.BackgroundSessions.text_5ec9d22188")} confirmLabel={t("terminal.BackgroundSessions.text_3eaf8d1b81")} onConfirm={end} onCancel={() => setPending(null)} /> : null}
    </Presence>
  </section>;
}
