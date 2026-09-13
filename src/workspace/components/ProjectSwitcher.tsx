import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, ChevronsUpDown, FolderOpen, Settings2, Star, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { ICON } from "../../theme/sizing";
import type { ProjectWorkspace, RecentProject } from "../contracts";
import { normalizePath, pathKey, shortPath } from "../path";
import { useDismiss } from "../useDismiss";
import { createProfile, favoriteGroups, findProfile, unpinnedRecent } from "../projects/model";
import { useProjectCatalog } from "../projects/useProjectCatalog";
import { errorMessage } from "../projects/storage";
import { ProjectLibraryDialog } from "../projects/ProjectLibraryDialog";
import type { ProjectCatalog } from "../projects/contracts";

interface ProjectSwitcherProps {
  project: ProjectWorkspace | null;
  recentProjects: RecentProject[];
  opening: boolean;
  onOpen: (path: string | null) => Promise<void>;
  /** 条目悬停时的删除入口；确认框在 App 层渲染。 */
  onRequestRemove: (project: RecentProject) => void;
}

/**
 * 舞台标题行控件：显示当前会话的项目归属，点开可换。
 * 换项目会创建一个新的 Shell 会话，当前会话和它的 PTY 保持不变。
 * 最近项目条目悬停时右侧出现删除键（移除最近记录并关闭该目录下的会话）。
 */
export function ProjectSwitcher({
  project,
  recentProjects,
  opening,
  onOpen,
  onRequestRemove,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const library = useProjectCatalog();
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const pick = (next: string | null) => {
    setOpen(false);
    void onOpen(next);
  };

  const browse = async () => {
    // 取消选择返回 null，这时什么都不做，不能当成「打开默认项目」。
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "选择项目目录",
      // 文件对话框不认 `\\?\` 前缀，传进去会被静默忽略、退回默认位置。
      defaultPath: project ? normalizePath(project.rootPath) : undefined,
    });
    if (typeof selected === "string") pick(selected);
  };

  const currentKey = project ? pathKey(project.rootPath) : null;
  const recent = unpinnedRecent(library.catalog, recentProjects);
  const favorite = project ? findProfile(library.catalog, project.rootPath)?.favorite : false;
  const toggleFavorite = () => {
    if (!project) return;
    try {
      const entry = findProfile(library.catalog, project.rootPath) ?? createProfile(project);
      library.save({ ...entry, favorite: !entry.favorite }); setError(null);
    } catch (error) { setError(errorMessage(error)); }
  };
  const showManagement = () => { trigger.current?.focus(); setOpen(false); setManage(true); };

  return (
    <><div className="popover-host stage-switcher" ref={ref}>
      <button
        aria-expanded={open}
        className="project-trigger"
        ref={trigger}
        onClick={() => setOpen((value) => !value)}
        title={project ? `${normalizePath(project.rootPath)}（点击在新会话中切换目录）` : "选择项目"}
        type="button"
      >
        <span className="project-trigger__name">{project?.name ?? "选择项目"}</span>
        <span className="project-trigger__path">{shortPath(project?.rootPath) || "正在定位…"}</span>
        <ChevronsUpDown aria-hidden="true" size={ICON.xs} />
      </button>

      {open ? (
        <div className="popover popover--project" role="dialog" aria-label="在新会话中切换目录">
          {project ? <p className="project-location" title={normalizePath(project.rootPath)}>{normalizePath(project.rootPath)}</p> : null}
          {library.error || error ? <p className="project-library__error" role="alert">{library.error ?? error}</p> : null}
          <FavoriteProjects catalog={library.catalog} onPick={pick} currentKey={currentKey} />
          {recent.length > 0 ? (
            <div className="popover-list">
              {recent.map((item) => (
                <div className="popover-list__item" key={item.id}>
                  <button className="popover-list__main" onClick={() => pick(item.rootPath)} type="button">
                    <span className="popover-list__text">
                      <strong>{item.name}</strong>
                      <small>{shortPath(item.rootPath)}</small>
                    </span>
                  </button>
                  <div className="popover-list__tail">
                    {pathKey(item.rootPath) === currentKey ? (
                      <Check aria-hidden="true" className="popover-list__check" size={ICON.sm} />
                    ) : null}
                    <button
                      aria-label={`删除 ${item.name} 的最近记录`}
                      className="popover-list__delete"
                      onClick={() => onRequestRemove(item)}
                      title={`删除 ${item.name} 的最近记录`}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={ICON.xs} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <button className="popover-browse" disabled={opening} onClick={() => void browse()} type="button">
            <FolderOpen aria-hidden="true" size={ICON.md} />
            <span>浏览目录…</span>
          </button>
          <div className="project-picker-actions">
            <button type="button" disabled={!project || !!library.error} aria-pressed={!!favorite} onClick={toggleFavorite}>
              <Star size={14} className={favorite ? "project-favorites__star" : undefined} />{favorite ? "取消收藏" : "收藏当前项目"}</button>
            <button type="button" onClick={showManagement}><Settings2 size={14} />项目设置</button>
          </div>
        </div>
      ) : null}
    </div>{manage ? <ProjectLibraryDialog project={project} onClose={() => setManage(false)} /> : null}</>
  );
}

function FavoriteProjects({ catalog, onPick, currentKey }: { catalog: ProjectCatalog; onPick: (path: string) => void; currentKey: string | null }) {
  const groups = favoriteGroups(catalog);
  if (!groups.length) return null;
  return <div className="project-favorites">{groups.map(([name, entries]) => <section key={name} aria-label={`收藏分组：${name}`}>
    <h3>{name}</h3><div className="popover-list">{entries.map((entry) => <div className="popover-list__item" key={entry.id}>
      <button type="button" className="popover-list__main" onClick={() => onPick(entry.project.rootPath)}>
        <span className="popover-list__text"><strong>{entry.project.name}</strong><small>{shortPath(entry.project.rootPath)}</small></span></button>
      {pathKey(entry.project.rootPath) === currentKey ? <Check size={14} className="popover-list__check" /> : <Star size={12} className="project-favorites__star" />}
    </div>)}</div></section>)}</div>;
}
