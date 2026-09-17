import { useEffect, useRef, useState } from "react";
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
  return <div className="history-filters history-search-controls">
    <SearchInput value={filters.text} onChange={(text) => onChange({ text })} />
    <div className="history-segments" role="group" aria-label="筛选 Agent">
      {(["all", "codex", "claude", "pi"] as const).map((agent) => <button key={agent} type="button"
        className={filters.agent === agent ? "is-active" : undefined} aria-pressed={filters.agent === agent}
        onClick={() => onChange({ agent, project: "" })}>
        {agent === "all" ? "全部" : agent === "codex" ? "Codex" : agent === "claude" ? "Claude" : "Pi"}
      </button>)}
    </div>
    <Select ariaLabel="筛选项目" value={filters.project} onChange={(project) => onChange({ project })}
      options={[{ value: "", label: "所有项目" }, ...projects.map((project) => ({ value: project,
        label: project.split(/[\\/]/).filter(Boolean).at(-1) || project, description: project }))]} />
    <div className="history-date-range">
      <label><span>开始日期</span><DatePicker ariaLabel="开始日期" value={filters.startDate} showError={false}
        onChange={(startDate) => onChange({ startDate })} /></label>
      <label><span>结束日期</span><DatePicker ariaLabel="结束日期" value={filters.endDate} showError={false}
        onChange={(endDate) => onChange({ endDate })} /></label>
    </div>
    <div className="history-saved-filters">
      <button type="button" className={filters.favoriteOnly ? "is-active" : undefined}
        aria-pressed={filters.favoriteOnly} onClick={() => onChange({ favoriteOnly: !filters.favoriteOnly })}>
        <Star size={ICON.xs} aria-hidden="true" />只看收藏
      </button>
      <Select ariaLabel="筛选标签" value={filters.tag} onChange={(tag) => onChange({ tag })}
        options={[{ value: "", label: "所有标签" }, ...tags.map((tag) => ({ value: tag, label: tag }))]} />
    </div>
  </div>;
}

function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return <div className="history-search-input">
    <Search size={ICON.sm} aria-hidden="true" />
    <input aria-label="搜索历史正文" placeholder="搜索标题、对话或命令…" value={draft}
      maxLength={HISTORY_QUERY_LIMIT} spellCheck={false} type="search"
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(event) => { composing.current = false; onChange(event.currentTarget.value); }}
      onChange={(event) => { setDraft(event.target.value); if (!composing.current) onChange(event.target.value); }} />
    {draft ? <button type="button" aria-label="清除搜索" onClick={() => { setDraft(""); onChange(""); }}>
      <X size={ICON.xs} aria-hidden="true" />
    </button> : null}
  </div>;
}
