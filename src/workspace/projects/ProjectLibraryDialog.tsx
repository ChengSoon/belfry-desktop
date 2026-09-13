import { FolderPlus, Search, Star, X } from "lucide-react";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useDialog } from "../../components/controls/useDialog";
import { openProject } from "../api";
import type { ProjectWorkspace } from "../contracts";
import { shortPath } from "../path";
import type { ProjectProfile } from "./contracts";
import { createProfile, findProfile } from "./model";
import { errorMessage } from "./storage";
import { useProjectCatalog } from "./useProjectCatalog";
import { ProjectProfileForm } from "./ProjectProfileForm";
import "./projectLibrary.css";

interface Props { project: ProjectWorkspace | null; onClose: () => void }

export function ProjectLibraryDialog({ project, onClose }: Props) {
  const library = useProjectCatalog();
  const [selected, setSelected] = useState<ProjectProfile | null>(() => project
    ? findProfile(library.catalog, project.rootPath) ?? createProfile(project) : library.catalog.entries[0] ?? null);
  const [guarded, setGuarded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const blocked = guarded || busy;
  const ref = useDialog(onClose, blocked);
  const save = useCallback((profile: ProjectProfile) => {
    const current = library.catalog.entries.find((entry) => entry.id === profile.id);
    if (current && JSON.stringify(current) !== JSON.stringify(selected)) throw new Error("此项目已在其他窗口修改，请取消草稿并重新选择后编辑");
    const saved = library.save(profile); setSelected(saved); return saved;
  }, [library.catalog.entries, library.save, selected]);
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const path = await openDialog({ directory: true, multiple: false, title: "添加项目" });
      if (typeof path === "string") {
        const workspace = await openProject(path);
        setSelected(findProfile(library.catalog, workspace.rootPath) ?? { ...createProfile(workspace), favorite: true });
      }
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return createPortal(<div className="modal-scrim" onMouseDown={(event) => { if (!blocked && event.target === event.currentTarget) onClose(); }}>
    <div className="project-library" role="dialog" aria-modal="true" aria-label="项目收藏与设置" ref={ref}>
      <header className="project-library__header"><div><h2>项目</h2><p>把常用项目和启动习惯放在一起。</p></div>
        <button type="button" aria-label="关闭项目设置" title={blocked ? "请先保存或取消修改" : "关闭"} disabled={blocked} onClick={onClose}><X size={17} /></button></header>
      {library.error || error ? <p className="project-library__error" role="alert">{library.error ?? error}
        <button type="button" onClick={library.reload}>重新读取</button></p> : null}
      <div className="project-library__body"><aside>
        <label className="project-library__search"><Search size={14} /><input aria-label="搜索收藏项目" value={query} placeholder="搜索项目或分组"
          onChange={(event) => setQuery(event.target.value)} /></label>
        <ProjectList entries={library.catalog.entries} selected={selected} query={query} blocked={blocked} onSelect={setSelected} />
        <button className="project-library__add" type="button" disabled={blocked} onClick={() => void add()}><FolderPlus size={15} />添加目录…</button>
      </aside><main>{selected ? <ProjectProfileForm key={selected.id} profile={selected} onSave={save} onGuard={setGuarded}
        groups={[...new Set(library.catalog.entries.map((entry) => entry.group).filter(Boolean))]} />
        : <p className="project-library__empty">选择一个目录，开始整理项目。</p>}</main></div>
    </div></div>, document.body);
}

function ProjectList({ entries, selected, query, blocked, onSelect }: {
  entries: ProjectProfile[]; selected: ProjectProfile | null; query: string; blocked: boolean; onSelect: (entry: ProjectProfile) => void;
}) {
  const candidates = selected && !entries.some((entry) => entry.id === selected.id) ? [selected, ...entries] : entries;
  const visible = candidates.filter((entry) => `${entry.project.name} ${entry.project.rootPath} ${entry.group}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.group.localeCompare(b.group, "zh-CN") || a.project.name.localeCompare(b.project.name, "zh-CN"));
  return <nav aria-label="保存的项目" className="project-library__list">
    {visible.map((entry) => <button type="button" key={entry.id} disabled={blocked && selected?.id !== entry.id}
      aria-current={selected?.id === entry.id} onClick={() => onSelect(entry)} title={entry.project.rootPath}>
      <span><strong>{entry.project.name}</strong><small>{entry.group || shortPath(entry.project.rootPath)}</small></span>
      {entry.favorite ? <Star size={13} aria-label="已收藏" /> : null}</button>)}
    {!visible.length ? <p className="project-library__note">没有匹配的项目</p> : null}
  </nav>;
}
