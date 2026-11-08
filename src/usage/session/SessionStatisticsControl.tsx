import { t, useTranslation } from "../../i18n";
import { ChartNoAxesColumnIncreasing, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentSessionRef } from "../../agent/contracts";
import { ICON } from "../../theme/sizing";
import type { StatisticsView } from "./contracts";
import { StatisticsBody } from "./StatisticsBody";
import { useSessionStatistics } from "./useSessionStatistics";
import { composingKey } from "../../utils/keyboard";
import "./sessionStatistics.css";

interface Props { session: AgentSessionRef | null; transcriptPath: string | null; note: string | null; visible: boolean }

export function SessionStatisticsControl({ session, transcriptPath, note, visible }: Props) {
  useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const state = useSessionStatistics({ enabled: open && visible, session, transcriptPath });
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => { setOpen(false); button.current?.focus(); };
  return <div className="session-stats-control" ref={root}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    onKeyDown={(event) => {
      if (composingKey(event.nativeEvent) || event.key !== "Escape" || !open) return;
      event.stopPropagation(); event.preventDefault(); close();
    }}>
    <button className="session-stats-trigger" type="button" ref={button} title={t("usage.SessionStatisticsControl.text_b19b9753bc")} aria-label={t("usage.SessionStatisticsControl.text_b19b9753bc")}
      aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <ChartNoAxesColumnIncreasing aria-hidden="true" size={ICON.xs} /><span>{t("usage.SessionStatisticsControl.text_89abe8c6ac")}</span>
    </button>
    {open && visible ? <StatisticsPopover state={state} bound={Boolean(session)} note={note} onClose={close} /> : null}
  </div>;
}

function StatisticsPopover({ state, bound, note, onClose }: { state: StatisticsView; bound: boolean; note: string | null; onClose: () => void }) {
  useTranslation();
  return <section className="session-stats-popover" role="dialog" aria-label={t("usage.SessionStatisticsControl.text_b19b9753bc")}>
    <header><h3>{t("usage.SessionStatisticsControl.text_b19b9753bc")}</h3><button type="button" className="icon-button icon-button--sm" autoFocus title={t("usage.SessionStatisticsControl.text_a94f297948")} onClick={onClose}>
      <X aria-hidden="true" size={ICON.sm} />
    </button></header>
    <StatisticsBody state={state} bound={bound} note={note} />
  </section>;
}
