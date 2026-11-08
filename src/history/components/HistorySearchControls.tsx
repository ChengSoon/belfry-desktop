import { t, useTranslation } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { AGENT_KINDS, AGENT_METADATA } from "../../agent/contracts";
import { Search, Star, X } from "lucide-react";
import { HISTORY_QUERY_LIMIT, type HistoryFilters } from "../search";
import { ICON } from "../../theme/sizing";
import { Select } from "../../components/controls/Select";
import { DatePicker } from "../../components/controls/DatePicker";

interface Props {
  filters: HistoryFilters;
  projects: string[];
  tags: string[];
  onChange: (patch: Partial<HistoryFilters>) => void;
}

export function HistorySearchControls({ filters, projects, tags, onChange }: Props) {
  useTranslation();
  return <div className="history-filters history-search-controls">
    <p className="history-source">{t("history.HistorySearchControls.text_7908d73884")}</p>
    <SearchInput value={filters.text} onChange={(text) => onChange({ text })} />
    <div className="history-segments" role="group" aria-label={t("history.HistorySearchControls.text_9e557edb39")}>
      {(["all", ...AGENT_KINDS] as const).map((agent) => <button key={agent} type="button"
        className={filters.agent === agent ? "is-active" : undefined} aria-pressed={filters.agent === agent}
        onClick={() => onChange({ agent, project: "" })}>
        {agent === "all" ? t("history.HistorySearchControls.text_5c55a67935") : AGENT_METADATA[agent].name}
      </button>)}
    </div>
    <Select ariaLabel={t("history.HistorySearchControls.text_a16724654f")} value={filters.project} onChange={(project) => onChange({ project })}
      options={[{ value: "", label: t("history.HistorySearchControls.text_c7a4e66eb7") }, ...projects.map((project) => ({ value: project,
        label: project.split(/[\\/]/).filter(Boolean).at(-1) || project, description: project }))]} />
    <div className="history-date-range">
      <label><span>{t("history.HistorySearchControls.text_760506491e")}</span><DatePicker ariaLabel={t("history.HistorySearchControls.text_760506491e")} value={filters.startDate} showError={false}
        onChange={(startDate) => onChange({ startDate })} /></label>
      <label><span>{t("history.HistorySearchControls.text_895cd52fbb")}</span><DatePicker ariaLabel={t("history.HistorySearchControls.text_895cd52fbb")} value={filters.endDate} showError={false}
        onChange={(endDate) => onChange({ endDate })} /></label>
    </div>
    <div className="history-saved-filters">
      <button type="button" className={filters.favoriteOnly ? "is-active" : undefined}
        aria-pressed={filters.favoriteOnly} onClick={() => onChange({ favoriteOnly: !filters.favoriteOnly })}>
        <Star size={ICON.xs} aria-hidden="true" />{t("history.HistorySearchControls.text_bff836d78d")}</button>
      <Select ariaLabel={t("history.HistorySearchControls.text_2d8b5c909a")} value={filters.tag} onChange={(tag) => onChange({ tag })}
        options={[{ value: "", label: t("history.HistorySearchControls.text_5825239366") }, ...tags.map((tag) => ({ value: tag, label: tag }))]} />
    </div>
  </div>;
}

function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  useTranslation();
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return <div className="history-search-input">
    <Search size={ICON.sm} aria-hidden="true" />
    <input aria-label={t("history.HistorySearchControls.text_d269788cf5")} placeholder={t("history.HistorySearchControls.text_c24f5bc784")} value={draft}
      maxLength={HISTORY_QUERY_LIMIT} spellCheck={false} type="search"
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(event) => { composing.current = false; onChange(event.currentTarget.value); }}
      onChange={(event) => { setDraft(event.target.value); if (!composing.current) onChange(event.target.value); }} />
    {draft ? <button type="button" aria-label={t("history.HistorySearchControls.text_ee32f25f70")} onClick={() => { setDraft(""); onChange(""); }}>
      <X size={ICON.xs} aria-hidden="true" />
    </button> : null}
  </div>;
}
