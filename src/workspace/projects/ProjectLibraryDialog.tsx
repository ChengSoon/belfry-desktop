import { useFeedback, TranslationError, getLocale, t, useTranslation } from "../../i18n";
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
  useTranslation();
  const library = useProjectCatalog();
  const [selected, setSelected] = useState<ProjectProfile | null>(() => project
    ? findProfile(library.catalog, project.rootPath) ?? createProfile(project) : library.catalog.entries[0] ?? null);
  const [guarded, setGuarded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedback<string | null>(null);
  const [query, setQuery] = useState("");
  const blocked = guarded || busy;
  const ref = useDialog(onClose, blocked);
  const save = useCallback((profile: ProjectProfile) => {
    const current = library.catalog.entries.find((entry) => entry.id === profile.id);
    if (current && JSON.stringify(current) !== JSON.stringify(selected)) throw new TranslationError("workspace.ProjectLibraryDialog.text_3a127d483f");
    const saved = library.save(profile); setSelected(saved); return saved;
  }, [library.catalog.entries, library.save, selected]);
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const path = await openDialog({ directory: true, multiple: false, title: t("workspace.ProjectLibraryDialog.text_8964f53ac3") });
      if (typeof path === "string") {
        const workspace = await openProject(path);
        setSelected(findProfile(library.catalog, workspace.rootPath) ?? { ...createProfile(workspace), favorite: true });
      }
    } catch (error) { setError(() => errorMessage(error)); }
    finally { setBusy(false); }
  };
  return createPortal(<div className="modal-scrim" onMouseDown={(event) => { if (!blocked && event.target === event.currentTarget) onClose(); }}>
    <div className="project-library" role="dialog" aria-modal="true" aria-label={t("workspace.ProjectLibraryDialog.text_c04a4107ee")} ref={ref}>
      <header className="project-library__header"><div><h2>{t("workspace.ProjectLibraryDialog.text_79f326be44")}</h2><p>{t("workspace.ProjectLibraryDialog.text_39d1448dab")}</p></div>
        <button type="button" aria-label={t("workspace.ProjectLibraryDialog.text_578d675e83")} title={blocked ? t("workspace.ProjectLibraryDialog.text_b02fdaeede") : t("workspace.ProjectLibraryDialog.text_3fd47edce4")} disabled={blocked} onClick={onClose}><X size={17} /></button></header>
      {library.error || error ? <p className="project-library__error" role="alert">{library.error ?? error}
        <button type="button" onClick={library.reload}>{t("workspace.ProjectLibraryDialog.text_df7392cc96")}</button></p> : null}
      <div className="project-library__body"><aside>
        <label className="project-library__search"><Search size={14} /><input aria-label={t("workspace.ProjectLibraryDialog.text_e47c8838c7")} value={query} placeholder={t("workspace.ProjectLibraryDialog.text_a685504989")}
          onChange={(event) => setQuery(event.target.value)} /></label>
        <ProjectList entries={library.catalog.entries} selected={selected} query={query} blocked={blocked} onSelect={setSelected} />
        <button className="project-library__add" type="button" disabled={blocked} onClick={() => void add()}><FolderPlus size={15} />{t("workspace.ProjectLibraryDialog.text_0a700ea27d")}</button>
      </aside><main>{selected ? <ProjectProfileForm key={selected.id} profile={selected} onSave={save} onGuard={setGuarded}
        groups={[...new Set(library.catalog.entries.map((entry) => entry.group).filter(Boolean))]} />
        : <p className="project-library__empty">{t("workspace.ProjectLibraryDialog.text_4a35176f7c")}</p>}</main></div>
    </div></div>, document.body);
}

function ProjectList({ entries, selected, query, blocked, onSelect }: {
  entries: ProjectProfile[]; selected: ProjectProfile | null; query: string; blocked: boolean; onSelect: (entry: ProjectProfile) => void;
}) {
  useTranslation();
  const candidates = selected && !entries.some((entry) => entry.id === selected.id) ? [selected, ...entries] : entries;
  const visible = candidates.filter((entry) => `${entry.project.name} ${entry.project.rootPath} ${entry.group}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.group.localeCompare(b.group, getLocale()) || a.project.name.localeCompare(b.project.name, getLocale()));
  return <nav aria-label={t("workspace.ProjectLibraryDialog.text_cc796ca661")} className="project-library__list">
    {visible.map((entry) => <button type="button" key={entry.id} disabled={blocked && selected?.id !== entry.id}
      aria-current={selected?.id === entry.id} onClick={() => onSelect(entry)} title={entry.project.rootPath}>
      <span><strong>{entry.project.name}</strong><small>{entry.group || shortPath(entry.project.rootPath)}</small></span>
      {entry.favorite ? <Star size={13} aria-label={t("workspace.ProjectLibraryDialog.text_471dd4d7f8")} /> : null}</button>)}
    {!visible.length ? <p className="project-library__note">{t("workspace.ProjectLibraryDialog.text_3cc529ee7e")}</p> : null}
  </nav>;
}
