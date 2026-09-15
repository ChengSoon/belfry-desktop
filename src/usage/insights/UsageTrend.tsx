import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { ICON } from "../../theme/sizing";
import { formatExact, formatTokens } from "../format";
import type { AnalyticsReport, UsageBucket } from "./contracts";
import { calendarPage, dayLabel } from "./model";

interface Props {
  report: AnalyticsReport; rows: UsageBucket[]; selected: number | null | undefined;
  onSelect: (day: number) => void;
}

export function UsageTrend({ report, rows, selected, onSelect }: Props) {
  const [pageIndex, setPageIndex] = useState(0);
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const page = calendarPage(report, rows, pageIndex);
  const peak = Math.max(1, ...page.bars.map((bar) => bar.total));
  const focus = page.bars.some((bar) => bar.day === focusedDay) ? focusedDay : page.bars.at(-1)?.day;
  return <section className="usage-trend" aria-label="每日用量趋势">
    <header><h3>每日用量 <span>UTC</span></h3>
      {page.canPrevious || page.canNext ? <div className="usage-trend__pages">
        <button type="button" className="icon-button icon-button--sm" aria-label="查看更早 30 天" disabled={!page.canPrevious}
          onClick={() => setPageIndex(page.page + 1)}><ChevronLeft size={ICON.xs} /></button>
        <button type="button" className="icon-button icon-button--sm" aria-label="查看之后 30 天" disabled={!page.canNext}
          onClick={() => setPageIndex(page.page - 1)}><ChevronRight size={ICON.xs} /></button>
      </div> : null}
    </header>
    <div className="usage-trend__plot" role="group" aria-label="每日用量，左右方向键选择日期，Enter 查看明细">
      {page.bars.map((bar) => <button key={bar.day} type="button" aria-pressed={selected === bar.day}
        tabIndex={bar.day === focus ? 0 : -1} onFocus={() => setFocusedDay(bar.day)} onKeyDown={moveTrendFocus}
        title={dayLabel(bar.day) + " · " + formatExact(bar.total) + " Token"}
        aria-label={dayLabel(bar.day) + "，" + formatExact(bar.total) + " Token"}
        onClick={() => onSelect(bar.day)}>
        <i style={{ height: (bar.total > 0 ? Math.max(3, bar.total / peak * 100) : 0) + "%" }} />
      </button>)}
    </div>
    <footer><span>{page.bars[0] ? dayLabel(page.bars[0].day) : ""}</span>
      <span>峰值 {formatTokens(Math.max(...page.bars.map((bar) => bar.total), 0))}</span>
      <span>{page.bars.at(-1) ? dayLabel(page.bars.at(-1)!.day).slice(5) : ""}</span></footer>
  </section>;
}

function moveTrendFocus(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const directions: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
  const direction = directions[event.key];
  if (direction === undefined) return;
  const buttons = [...event.currentTarget.parentElement!.querySelectorAll("button")];
  const index = buttons.indexOf(event.currentTarget);
  const next = Math.max(0, Math.min(buttons.length - 1, index + direction));
  event.preventDefault();
  buttons[next]?.focus();
}
