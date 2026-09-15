import { Ellipsis, FileSearch, Keyboard, Moon, PanelLeftOpen, PanelRight, Plug, Search, Sun, Users } from "lucide-react";
import type { ReactNode } from "react";
import { togglePluginDock, togglePluginLauncher } from "../plugins/workspace/events";
import { appShortcutChord, formatShortcutChord } from "../shortcuts/resolveShortcut";
import { useTheme } from "../theme/ThemeProvider";
import { ICON } from "../theme/sizing";
import { ProjectSwitcher } from "../workspace/components/ProjectSwitcher";
import type { WorkbenchProps } from "./Workbench";
import { useFlyout } from "./useFlyout";
import { WorktreeReminder } from "../git/worktrees/WorktreeReminder";

export function WorkbenchToolbar(props: WorkbenchProps) {
  const flyout = useFlyout();
  const shortcut = (key: string) => formatShortcutChord(appShortcutChord(props.shortcutPlatform, key));
  return (
    <header className="workbench-toolbar">
      {props.collapsed ? <button className="icon-button icon-button--sm" aria-label="展开侧栏" title={`展开侧栏 ${shortcut("B")}`}
        onClick={props.onRevealSidebar} type="button"><PanelLeftOpen size={ICON.md} /></button> : null}
      <div className="workbench-toolbar__project"><ProjectSwitcher onOpen={props.onOpenProject}
        onRequestRemove={props.onRequestRemove} opening={props.opening} project={props.activeProject} recentProjects={props.recentProjects} /></div>
      <div className="workbench-toolbar__tools">
        <WorktreeReminder project={props.activeProject} tabs={props.tabs} onOpen={props.onOpenProject} />
        <button className="icon-button icon-button--sm workbench-search" aria-label="Quick Open" aria-expanded={props.quickOpenOpen}
          title={`搜索会话与操作 ${shortcut("K")}`} onClick={props.onToggleQuickOpen} type="button"><Search size={ICON.md} /></button>
        <button className="icon-button icon-button--sm workbench-inspector" aria-label="文件预览" aria-expanded={props.previewOpen}
          title="文件与 Git 改动" onClick={props.onTogglePreview} type="button"><FileSearch size={ICON.md} /></button>
        <div className="workbench-more" ref={flyout.root}>
          <button className="icon-button icon-button--sm" ref={flyout.trigger} aria-label={props.collabWaiting ? `更多工具，${props.collabWaiting} 条协作待确认` : "更多工具"}
            aria-controls={flyout.id} aria-expanded={flyout.open} aria-haspopup="dialog" title="更多工具" onClick={flyout.toggle} type="button">
            <Ellipsis size={ICON.md} />{props.collabWaiting ? <i className="workbench-more__badge" /> : null}
          </button>
          {flyout.open ? <div className="workbench-menu" id={flyout.id} role="dialog" aria-label="更多工具">
            <WorkbenchMenuItems {...props} onSelect={flyout.close} />
          </div> : null}
        </div>
      </div>
    </header>
  );
}

export function WorkbenchMenuItems(props: WorkbenchProps & { onSelect: () => void }) {
  const run = (action: () => void) => () => { props.onSelect(); action(); };
  return <>
    <ToolItem icon={Users} active={props.collabOpen} focus onClick={run(props.onToggleCollab)}>
      会话协作{props.collabWaiting ? <small>{props.collabWaiting} 条待确认</small> : null}
    </ToolItem>
    <ToolItem icon={Plug} onClick={run(togglePluginLauncher)}>插件启动器<kbd>Alt+Space</kbd></ToolItem>
    <ToolItem icon={PanelRight} active={props.pluginDockOpen} onClick={run(togglePluginDock)}>插件工作面板</ToolItem>
    <div className="workbench-menu__narrow">
      <ToolItem icon={Search} active={props.quickOpenOpen} onClick={run(props.onToggleQuickOpen)}>Quick Open</ToolItem>
      <ToolItem icon={FileSearch} active={props.previewOpen} onClick={run(props.onTogglePreview)}>文件与 Git 改动</ToolItem>
    </div>
    <div className="workbench-menu__divider" />
    <ToolItem icon={Keyboard} active={props.shortcutGuideOpen} onClick={run(props.onOpenShortcutGuide)}>快捷指令</ToolItem>
    <ThemeMenuItem onSelect={props.onSelect} />
  </>;
}

function ThemeMenuItem({ onSelect }: { onSelect: () => void }) {
  const { mode, toggle } = useTheme();
  return <ToolItem icon={mode === "light" ? Moon : Sun} onClick={() => { onSelect(); toggle(); }}>
    {mode === "light" ? "切换到暗色主题" : "切换到亮色主题"}
  </ToolItem>;
}

function ToolItem({ icon: Icon, children, onClick, active, focus }: {
  icon: typeof Search; children: ReactNode; onClick: () => void; active?: boolean; focus?: boolean;
}) {
  return <button className="workbench-menu__item" type="button" aria-pressed={active} data-flyout-focus={focus || undefined}
    onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
    <Icon aria-hidden="true" size={ICON.sm} /><span>{children}</span>
  </button>;
}
