import { t, useTranslation } from "../../i18n";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { ICON } from "../../theme/sizing";
import { formatTokens } from "../format";
import type { AnalyticsReport, UsageBucket } from "./contracts";
import { calendarPage, dayLabel } from "./model";
import { composingKey } from "../../utils/keyboard";

interface Props {
  report: AnalyticsReport; rows: UsageBucket[]; selected: number | null | undefined;
  onSelect: (day: number) => void;
}

export function UsageTrend({ report, rows, selected, onSelect }: Props) {
  useTranslation();
  const [pageIndex, setPageIndex] = useState(0);
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const page = calendarPage(report, rows, pageIndex);
  const peak = Math.max(1, ...page.bars.map((bar) => bar.total));
  const focus = page.bars.some((bar) => bar.day === focusedDay) ? focusedDay : page.bars.at(-1)?.day;
  return <section className="usage-trend" aria-label={t("usage.UsageTrend.text_0cc2efa505")}>
    <header><h3>{t("usage.UsageTrend.text_cff5e55f1c")}<span>UTC</span></h3>
      {page.canPrevious || page.canNext ? <div className="usage-trend__pages">
        <button type="button" className="icon-button icon-button--sm" aria-label={t("usage.UsageTrend.text_d142a27de8")} disabled={!page.canPrevious}
          onClick={() => setPageIndex(page.page + 1)}><ChevronLeft size={ICON.xs} /></button>
        <button type="button" className="icon-button icon-button--sm" aria-label={t("usage.UsageTrend.text_956e229866")} disabled={!page.canNext}
          onClick={() => setPageIndex(page.page - 1)}><ChevronRight size={ICON.xs} /></button>
      </div> : null}
    </header>
    <div className="usage-trend__plot" role="group" aria-label={t("usage.UsageTrend.text_6923995094")}>
      {page.bars.map((bar) => <button key={bar.day} type="button" aria-pressed={selected === bar.day}
        tabIndex={bar.day === focus ? 0 : -1} onFocus={() => setFocusedDay(bar.day)} onKeyDown={moveTrendFocus}
        title={t("usage.UsageTrend.dayTokens", { date: dayLabel(bar.day), count: bar.total })}
        aria-label={t("usage.UsageTrend.dayTokens", { date: dayLabel(bar.day), count: bar.total })}
        onClick={() => onSelect(bar.day)}>
        <i style={{ height: (bar.total > 0 ? Math.max(3, bar.total / peak * 100) : 0) + "%" }} />
      </button>)}
    </div>
    <footer><span>{page.bars[0] ? dayLabel(page.bars[0].day) : ""}</span>
      <span>{t("usage.UsageTrend.peak", { tokens: formatTokens(Math.max(...page.bars.map((bar) => bar.total), 0)) })}</span>
      <span>{page.bars.at(-1) ? dayLabel(page.bars.at(-1)!.day, true) : ""}</span></footer>
  </section>;
}

function moveTrendFocus(event: KeyboardEvent<HTMLButtonElement>) {
  if (composingKey(event.nativeEvent) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const directions: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
  const direction = directions[event.key];
  if (direction === undefined) return;
  const buttons = [...event.currentTarget.parentElement!.querySelectorAll("button")];
  const index = buttons.indexOf(event.currentTarget);
  const next = Math.max(0, Math.min(buttons.length - 1, index + direction));
  event.preventDefault();
  buttons[next]?.focus();
}
