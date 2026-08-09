import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, ChevronsUpDown, FolderOpen } from "lucide-react";
import { useState } from "react";
import type { ProjectWorkspace, RecentProject } from "../contracts";
import { shortPath } from "../path";
import { useDismiss } from "../useDismiss";

interface ProjectSwitcherProps {
  project: ProjectWorkspace | null;
  recentProjects: RecentProject[];
  opening: boolean;
  onOpen: (path: string | null) => Promise<void>;
}

/**
 * 舞台标题行控件：显示当前会话的项目归属，点开可换。
 * 换项目会重启当前会话的 PTY——这是 cwd 只能在 spawn 时定的必然结果。
 */
export function ProjectSwitcher({ project, recentProjects, opening, onOpen }: ProjectSwitcherProps) {
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
      defaultPath: project?.rootPath,
    });
    if (typeof selected === "string") pick(selected);
  };

  return (
    <div className="popover-host stage-switcher" ref={ref}>
      <button
        aria-expanded={open}
        className="project-trigger"
        onClick={() => setOpen((value) => !value)}
        title={project ? `${project.rootPath}（点击切换当前会话的项目）` : "选择项目"}
        type="button"
      >
        <span className="project-trigger__name">{project?.name ?? "选择项目"}</span>
        <span className="project-trigger__path">{shortPath(project?.rootPath) || "正在定位…"}</span>
        <ChevronsUpDown aria-hidden="true" size={12} />
      </button>

      {open ? (
        <div className="popover popover--project" role="dialog" aria-label="切换当前会话的项目">
          {recentProjects.length > 0 ? (
            <div className="popover-list">
              {recentProjects.map((item) => (
                <button key={item.id} onClick={() => pick(item.rootPath)} type="button">
                  <span className="popover-list__text">
                    <strong>{item.name}</strong>
                    <small>{shortPath(item.rootPath)}</small>
                  </span>
                  {item.rootPath === project?.rootPath ? <Check aria-hidden="true" size={13} /> : null}
                </button>
              ))}
            </div>
          ) : null}
          <button className="popover-browse" disabled={opening} onClick={() => void browse()} type="button">
            <FolderOpen aria-hidden="true" size={14} />
            <span>浏览目录…</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
