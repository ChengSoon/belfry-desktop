import { t, useTranslation } from "../../i18n";
import { Gauge, RefreshCcw, X } from "lucide-react";
import { Notice } from "../../components/Notice";
import type { CSSProperties } from "react";
import { PanelResizeHandle } from "../../panel/PanelResizeHandle";
import { usePanelWidth } from "../../panel/usePanelWidth";
import { ICON } from "../../theme/sizing";
import type { ProjectWorkspace } from "../../workspace/contracts";
import { USAGE_WINDOWS } from "../contracts";
import { UsageInsights } from "../insights/UsageInsights";
import { useUsageInsights } from "../insights/useUsageInsights";
import { USAGE_WIDTH } from "../usageWidth";
import "../usage.css";
import { Checkbox } from "../../components/controls/Checkbox";

interface UsagePanelProps { project: ProjectWorkspace | null; onClose: () => void }

export function UsagePanel({ project, onClose }: UsagePanelProps) {
  useTranslation();
  const usage = useUsageInsights(project?.rootPath ?? null);
  const { commitWidth, resetWidth, setWidth, width } = usePanelWidth(USAGE_WIDTH);
  const panelStyle = { "--usage-width": width + "px" } as CSSProperties;
  return (
    <section className="usage-panel" aria-label={t("usage.UsagePanel.text_d673833e7d")} style={panelStyle}>
      <header className="usage-head">
        <Gauge aria-hidden="true" size={ICON.md} /><h2>{t("usage.UsagePanel.text_42723e8b49")}</h2>
        <button className="icon-button icon-button--sm" disabled={usage.loading}
          onClick={() => void usage.reload()} title={t("usage.UsagePanel.text_77f321964f")} aria-label={t("usage.UsagePanel.text_77f321964f")} type="button">
          <RefreshCcw aria-hidden="true" size={ICON.sm} />
        </button>
        <button className="icon-button icon-button--sm" onClick={onClose} title={t("usage.UsagePanel.text_4afdbbce72")} aria-label={t("usage.UsagePanel.text_4afdbbce72")} type="button">
          <X aria-hidden="true" size={ICON.md} />
        </button>
      </header>
      <div className="usage-filters">
        <p className="usage-context">{t("usage.UsagePanel.text_a29638b5fb", { project: usage.scoped && project ? project.name : t("usage.UsagePanel.text_c7a4e66eb7") })}</p>
        <div className="usage-segments" role="group" aria-label={t("usage.UsagePanel.text_1888476e9c")}>
          {USAGE_WINDOWS.map((option) => <button aria-pressed={usage.windowDays === option.days}
            className={usage.windowDays === option.days ? "is-active" : undefined} key={option.label}
            onClick={() => usage.setWindowDays(option.days)} type="button">{option.label}</button>)}
        </div>
        {usage.canScope ? <label className="usage-scope" title={project?.rootPath}>
          <Checkbox checked={usage.scoped} onChange={usage.setScoped} ariaLabel={t("usage.UsagePanel.text_537a4bdb13", { name: project?.name })} />
          <span>{t("usage.UsagePanel.text_537a4bdb13", { name: project?.name })}</span>
        </label> : null}
      </div>
      {usage.error ? <Notice className="usage-error" action={<button type="button" disabled={usage.loading}
        onClick={() => void usage.reload()}>{t("usage.UsagePanel.text_b8784c8dd5")}</button>}>{usage.error}</Notice> : null}
      <div className="usage-body" aria-busy={usage.loading}>
        {usage.report ? <UsageInsights report={usage.report} project={project} /> : null}
        {usage.loading ? <p className="usage-hint" role="status">{t("usage.UsagePanel.text_a0253c8eaf")}</p> : null}
      </div>
      <PanelResizeHandle label={t("usage.UsagePanel.text_56b11bce6f")} onCommit={commitWidth} onReset={resetWidth}
        onResize={setWidth} spec={USAGE_WIDTH} width={width} />
    </section>
  );
}
