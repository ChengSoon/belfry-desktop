import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, ChevronsUpDown, FolderOpen, Trash2 } from "lucide-react";
import { useState } from "react";
import { ICON } from "../../theme/sizing";
import type { ProjectWorkspace, RecentProject } from "../contracts";
import { normalizePath, pathKey, shortPath } from "../path";
import { useDismiss } from "../useDismiss";

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
 * 换项目会重启当前会话的 PTY——这是 cwd 只能在 spawn 时定的必然结果。
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

  return (
    <div className="popover-host stage-switcher" ref={ref}>
      <button
        aria-expanded={open}
        className="project-trigger"
        onClick={() => setOpen((value) => !value)}
        title={project ? `${normalizePath(project.rootPath)}（点击切换当前会话的项目）` : "选择项目"}
        type="button"
      >
        <span className="project-trigger__name">{project?.name ?? "选择项目"}</span>
        <span className="project-trigger__path">{shortPath(project?.rootPath) || "正在定位…"}</span>
        <ChevronsUpDown aria-hidden="true" size={ICON.xs} />
      </button>

      {open ? (
        <div className="popover popover--project" role="dialog" aria-label="切换当前会话的项目">
          {recentProjects.length > 0 ? (
            <div className="popover-list">
              {recentProjects.map((item) => (
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
        </div>
      ) : null}
    </div>
  );
}
