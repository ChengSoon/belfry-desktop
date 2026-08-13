import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, ChevronsUpDown, FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ICON } from "../../theme/sizing";
import type { ProjectWorkspace, RecentProject } from "../contracts";
import { normalizePath, pathKey, shortPath } from "../path";
import { useDismiss } from "../useDismiss";

interface ProjectSwitcherProps {
  project: ProjectWorkspace | null;
  recentProjects: RecentProject[];
  opening: boolean;
  onOpen: (path: string | null) => Promise<void>;
  /** 右键条目 → 删除菜单 → 确认后的入口；确认框在 App 层渲染。 */
  onRequestRemove: (project: RecentProject) => void;
}

/** 右键菜单的固定尺寸，用来在视口边缘把菜单收进可视区。 */
const MENU_WIDTH = 128;
const MENU_HEIGHT = 40;

interface ContextMenuState {
  project: RecentProject;
  x: number;
  y: number;
}

/**
 * 舞台标题行控件：显示当前会话的项目归属，点开可换。
 * 换项目会重启当前会话的 PTY——这是 cwd 只能在 spawn 时定的必然结果。
 * 最近项目条目上右键可删除（移除最近记录并关闭该目录下的会话）。
 */
export function ProjectSwitcher({
  project,
  recentProjects,
  opening,
  onOpen,
  onRequestRemove,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const menuRef = useRef<HTMLDivElement>(null);

  // 菜单的条件渲染用不了 useDismiss，这里按同一套"外点 + Escape"模式挂全局监听。
  // 菜单渲染在 popover-host 内部，点击菜单里的按钮不会误关主弹层。
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

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
                <button
                  key={item.id}
                  onClick={() => pick(item.rootPath)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ project: item, x: event.clientX, y: event.clientY });
                  }}
                  type="button"
                >
                  <span className="popover-list__text">
                    <strong>{item.name}</strong>
                    <small>{shortPath(item.rootPath)}</small>
                  </span>
                  {pathKey(item.rootPath) === currentKey ? <Check aria-hidden="true" size={ICON.sm} /> : null}
                </button>
              ))}
            </div>
          ) : null}
          <button className="popover-browse" disabled={opening} onClick={() => void browse()} type="button">
            <FolderOpen aria-hidden="true" size={ICON.md} />
            <span>浏览目录…</span>
          </button>
        </div>
      ) : null}

      {menu ? (
        <div
          ref={menuRef}
          className="context-menu"
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8),
            top: Math.min(menu.y, window.innerHeight - MENU_HEIGHT - 8),
          }}
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setMenu(null);
              onRequestRemove(menu.project);
            }}
          >
            <Trash2 aria-hidden="true" size={ICON.sm} />
            <span>删除</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
