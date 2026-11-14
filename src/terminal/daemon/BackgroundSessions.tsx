import { useFeedback, t, useTranslation } from "../../i18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import type { TerminalSession } from "../contracts";
import { closeTerminal } from "../api";
import { errorMessage } from "../terminalController";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Presence } from "../../components/motion/Presence";
import { SButton, SGroupTitle, SList, STag } from "../../settings/kit";
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
  // 稿：「后台任务」分组标题 + 刷新，列表每行 状态点 + 名称/等宽路径 … 状态徽标 + 结束/清除。
  return <section className="background-sessions" aria-label={t("terminal.BackgroundSessions.text_4c46c90439")}>
    <SGroupTitle tail={<SButton className="background-sessions__refresh" disabled={busy} onClick={refresh}>
      <RefreshCw aria-hidden="true" className={busy ? "environment-spin" : undefined} size={14} />{t("terminal.BackgroundSessions.text_aee8874341")}</SButton>}>
      {t("terminal.BackgroundSessions.text_4c46c90439")}</SGroupTitle>
    {error ? <p className="sk-note is-danger" role="alert">{error}</p> : null}
    <SList>
      {!entries.length && !busy ? <p className="sk-empty">{t("terminal.BackgroundSessions.text_68b47478de")}</p> : null}
      {entries.length ? <ul className="background-sessions__list">{entries.map((entry) => {
        const running = entry.session.status === "running";
        return <li className="sk-item" data-state={running ? "running" : "exited"} key={entry.session.id}>
          <span className={`sk-dot${running ? "" : " is-off"}`} aria-hidden="true" />
          <div className="sk-l"><b>{entry.session.shell}</b><span className="sk-mono">{entry.session.cwd}</span></div>
          <div className="sk-r">
            <STag tone={running ? "ok" : undefined} dot={running}>{running ? t("terminal.BackgroundSessions.text_1f0eb99b7e") : t("terminal.BackgroundSessions.text_899df7e244")}</STag>
            <SButton disabled={busy} onClick={() => setPending(entry)} tone={running ? "danger" : "ghost"}>{running ? t("terminal.BackgroundSessions.text_c7b24e7997") : t("terminal.BackgroundSessions.text_bce2377283")}</SButton>
          </div>
        </li>;
      })}</ul> : null}
    </SList>
    <p className="sk-lede">{t("terminal.BackgroundSessions.text_59141671b0")}</p>
    <Presence open={!!pending}>
    {pending ? <ConfirmDialog title={t("terminal.BackgroundSessions.text_109157c118")} body={t("terminal.BackgroundSessions.text_5ec9d22188")} confirmLabel={t("terminal.BackgroundSessions.text_3eaf8d1b81")} onConfirm={end} onCancel={() => setPending(null)} /> : null}
    </Presence>
  </section>;
}
