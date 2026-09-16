import { ChartNoAxesColumnIncreasing, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentSessionRef } from "../../agent/contracts";
import { ICON } from "../../theme/sizing";
import type { StatisticsView } from "./contracts";
import { StatisticsBody } from "./StatisticsBody";
import { useSessionStatistics } from "./useSessionStatistics";
import "./sessionStatistics.css";

interface Props { session: AgentSessionRef | null; transcriptPath: string | null; note: string | null; visible: boolean }

export function SessionStatisticsControl({ session, transcriptPath, note, visible }: Props) {
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
      if (event.nativeEvent.isComposing || event.key !== "Escape" || !open) return;
      event.stopPropagation(); event.preventDefault(); close();
    }}>
    <button className="session-stats-trigger" type="button" ref={button} title="当前会话统计" aria-label="当前会话统计"
      aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <ChartNoAxesColumnIncreasing aria-hidden="true" size={ICON.xs} /><span>统计</span>
    </button>
    {open && visible ? <StatisticsPopover state={state} bound={Boolean(session)} note={note} onClose={close} /> : null}
  </div>;
}

function StatisticsPopover({ state, bound, note, onClose }: { state: StatisticsView; bound: boolean; note: string | null; onClose: () => void }) {
  return <section className="session-stats-popover" role="dialog" aria-label="当前会话统计">
    <header><h3>当前会话统计</h3><button type="button" className="icon-button icon-button--sm" autoFocus title="关闭会话统计" onClick={onClose}>
      <X aria-hidden="true" size={ICON.sm} />
    </button></header>
    <StatisticsBody state={state} bound={bound} note={note} />
  </section>;
}
