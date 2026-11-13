import { useFeedback, t, useTranslation } from "../../i18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import type { TerminalSession } from "../contracts";
import { closeTerminal } from "../api";
import { errorMessage } from "../terminalController";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Presence } from "../../components/motion/Presence";
import { Notice } from "../../components/Notice";
import "../../settings/obsidianSections.css";
import "./daemon.css";

interface BackgroundSession { session: TerminalSession; tabId: string | null; profileId: string }

export function BackgroundSessions() {
  useTranslation();
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
  // 曜石稿（T19 hooks）：后台任务是独立分组，常驻展开，进入分区即读取一次。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, []);
  return <section className="background-sessions os-section" aria-label={t("terminal.BackgroundSessions.text_4c46c90439")}>
    <div className="os-group-head">
      <h3>{t("terminal.BackgroundSessions.text_4c46c90439")}</h3>
      <button className="os-btn background-sessions__refresh" type="button" disabled={busy} onClick={refresh}>
        <RefreshCw aria-hidden="true" className={busy ? "environment-spin" : undefined} size={14} />{t("terminal.BackgroundSessions.text_aee8874341")}</button>
    </div>
    <p className="background-sessions__desc">{t("terminal.BackgroundSessions.text_59141671b0")}</p>
    {error ? <Notice role="alert">{error}</Notice> : null}
    <div className="os-group">
      {!entries.length && !busy ? <p className="os-empty">{t("terminal.BackgroundSessions.text_68b47478de")}</p> : null}
      {entries.length ? <ul className="background-sessions__list">{entries.map((entry) => {
        const running = entry.session.status === "running";
        return <li data-state={running ? "running" : "exited"} key={entry.session.id}>
          <span className={`background-sessions__dot${running ? " is-running" : ""}`} aria-hidden="true" />
          <div className="background-sessions__copy"><strong>{entry.session.shell}</strong><small>{entry.session.cwd}</small></div>
          <span className={`os-tag${running ? " ok" : ""}`}>{running ? t("terminal.BackgroundSessions.text_1f0eb99b7e") : t("terminal.BackgroundSessions.text_899df7e244")}</span>
          <button className={`os-btn${running ? " danger-ghost" : ""}`} type="button" disabled={busy} onClick={() => setPending(entry)}>{running ? t("terminal.BackgroundSessions.text_c7b24e7997") : t("terminal.BackgroundSessions.text_bce2377283")}</button>
        </li>;
      })}</ul> : null}
    </div>
    <Presence open={!!pending}>
    {pending ? <ConfirmDialog title={t("terminal.BackgroundSessions.text_109157c118")} body={t("terminal.BackgroundSessions.text_5ec9d22188")} confirmLabel={t("terminal.BackgroundSessions.text_3eaf8d1b81")} onConfirm={end} onCancel={() => setPending(null)} /> : null}
    </Presence>
  </section>;
}
