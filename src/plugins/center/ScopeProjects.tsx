// Adapted from PI-Desktop ScopeControl.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { normalizeProjectPath, resolveScope, withProject, withoutProject } from "./activation";
import type { PluginSummary, ProjectRecord } from "./types";
import { usePluginsPage } from "./context";
import { IconCheck, IconSearch, IconX } from "./icons";
import { cx } from "./ui";
import { t } from "./i18n";

export function scopeProjects(input: { current: string | null; selected: string[]; projects: ProjectRecord[] }) {
  const rows = new Map<string, ProjectRecord>();
  const candidates = [...(input.current ? [input.current] : []), ...input.selected].map((path) => ({ path, name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }));
  for (const item of [...candidates, ...input.projects]) {
    const key = normalizeProjectPath(item.path).toLocaleLowerCase();
    if (key && !rows.has(key)) rows.set(key, item);
  }
  return [...rows.values()];
}
export function ScopeProjects({ plugin, onClose }: { plugin: PluginSummary; onClose: () => void }) {
  const { data, actions, currentProjectPath } = usePluginsPage();
  const [query, setQuery] = useState(""), [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null), scope = resolveScope(plugin.scope);
  useLayoutEffect(() => { const box = ref.current?.getBoundingClientRect(); if (box) setUp(window.innerHeight - box.top < 340); }, []);
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [onClose]);
  const rows = scopeProjects({ current: currentProjectPath, selected: scope.projects, projects: data.projects })
    .filter((row) => `${row.name} ${row.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = (path: string) => scope.projects.some((entry) => normalizeProjectPath(entry).toLowerCase() === normalizeProjectPath(path).toLowerCase());
  return <div className="scope-projects is-compact" ref={ref}><div className={cx("scope-popover", up && "is-up")}
    role="dialog" aria-label={t("extensions.scope.pickerTitle", { name: plugin.name })}>
    <div className="scope-popover-head"><div className="scope-popover-title">{t("extensions.scope.pickerTitle", { name: plugin.name })}</div>
      <button type="button" className="scope-popover-close" aria-label={t("common.close")} onClick={onClose}><IconX size={12} /></button></div>
    <div className="scope-popover-search"><IconSearch size={12} /><input autoFocus spellCheck={false} value={query}
      placeholder={t("extensions.scope.searchProjects")} aria-label={t("extensions.scope.searchProjects")} onChange={(event) => setQuery(event.target.value)} /></div>
    <div className="scope-popover-list" role="listbox" aria-multiselectable>
      {!rows.length ? <p className="scope-popover-empty">{t("extensions.scope.noProjects")}</p> : rows.map((row) =>
        <button key={row.path} type="button" role="option" aria-selected={selected(row.path)} className={cx("scope-option", selected(row.path) && "is-on")}
          disabled={actions.busy} onClick={() => void actions.setScope(plugin, selected(row.path) ? withoutProject(scope, row.path) : withProject(scope, row.path))}>
          <span className="scope-option-check" aria-hidden>{selected(row.path) ? <IconCheck size={12} /> : null}</span>
          <span className="scope-option-copy"><span className="scope-option-name">{row.name}
            {row.path === currentProjectPath ? <span className="scope-option-tag">{t("extensions.scope.currentProject")}</span> : null}</span>
            <span className="scope-option-path">{row.path}</span></span></button>)}
    </div><p className="scope-popover-foot">{t(scope.projects.length ? "extensions.scope.subdirectoryNote" : "extensions.scope.noProjectsWarning")}</p>
  </div></div>;
}
