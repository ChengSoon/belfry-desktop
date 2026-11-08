import { t, useTranslation } from "../i18n";
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
  useTranslation();
  const flyout = useFlyout();
  const shortcut = (key: string) => formatShortcutChord(appShortcutChord(props.shortcutPlatform, key));
  return (
    <header className="workbench-toolbar">
      {props.collapsed ? <button className="icon-button icon-button--sm" aria-label={t("components.WorkbenchToolbar.text_658ff1eade")} title={t("components.WorkbenchToolbar.text_8d70347006", { shortcut: shortcut("B") })}
        onClick={props.onRevealSidebar} type="button"><PanelLeftOpen size={ICON.md} /></button> : null}
      <div className="workbench-toolbar__project"><ProjectSwitcher onOpen={props.onOpenProject}
        onRequestRemove={props.onRequestRemove} opening={props.opening} project={props.activeProject} recentProjects={props.recentProjects} /></div>
      <div className="workbench-toolbar__tools">
        <WorktreeReminder project={props.activeProject} tabs={props.tabs} onOpen={props.onOpenProject} />
        <button className="workbench-search" aria-label="Quick Open" aria-expanded={props.quickOpenOpen}
          title={t("components.WorkbenchToolbar.text_8e31750772", { shortcut: shortcut("K") })} onClick={props.onToggleQuickOpen} type="button">
          <Search aria-hidden="true" size={ICON.md} /><span>{t("components.WorkbenchToolbar.text_13e21519f8")}</span><kbd>{shortcut("K")}</kbd>
        </button>
        <button className="icon-button icon-button--sm workbench-inspector" aria-label={t("components.WorkbenchToolbar.text_f3c5fe4dd2")} aria-expanded={props.previewOpen}
          title={t("components.WorkbenchToolbar.text_4f8ef4d52d")} onClick={props.onTogglePreview} type="button"><FileSearch size={ICON.md} /></button>
        <button className={`workbench-collab${props.collabWaiting ? " has-waiting" : ""}`} aria-label={t("components.WorkbenchToolbar.text_18a62218d6")}
          aria-expanded={props.collabOpen} title={props.collabWaiting ? t("components.WorkbenchToolbar.text_a597be7e16", { collabWaiting: props.collabWaiting }) : t("components.WorkbenchToolbar.text_18a62218d6")}
          onClick={props.onToggleCollab} type="button">
          <Users aria-hidden="true" size={ICON.md} />
          <span>{props.collabWaiting ? t("components.WorkbenchToolbar.text_95e697a349", { collabWaiting: props.collabWaiting }) : t("components.WorkbenchToolbar.text_19bf536853")}</span>
        </button>
        <ThemeToolbarButton />
        <div className="workbench-more" ref={flyout.root}>
          <button className="icon-button icon-button--sm" ref={flyout.trigger} aria-label={props.collabWaiting ? t("components.WorkbenchToolbar.text_6745834083", { collabWaiting: props.collabWaiting }) : t("components.WorkbenchToolbar.text_6ba91021aa")}
            aria-controls={flyout.id} aria-expanded={flyout.open} aria-haspopup="dialog" title={t("components.WorkbenchToolbar.text_6ba91021aa")} onClick={flyout.toggle} type="button">
            <Ellipsis size={ICON.md} />{props.collabWaiting ? <i className="workbench-more__badge" /> : null}
          </button>
          {flyout.open ? <div className="workbench-menu" id={flyout.id} role="dialog" aria-label={t("components.WorkbenchToolbar.text_6ba91021aa")}>
            <WorkbenchMenuItems {...props} onSelect={flyout.close} />
          </div> : null}
        </div>
      </div>
    </header>
  );
}

export function WorkbenchMenuItems(props: WorkbenchProps & { onSelect: () => void }) {
  useTranslation();
  const run = (action: () => void) => () => { props.onSelect(); action(); };
  return <>
    <ToolItem icon={Users} active={props.collabOpen} focus onClick={run(props.onToggleCollab)}>{t("components.WorkbenchToolbar.text_18a62218d6")}{props.collabWaiting ? <small>{t("components.WorkbenchToolbar.pendingConfirmations", { count: props.collabWaiting })}</small> : null}
    </ToolItem>
    <ToolItem icon={Plug} onClick={run(togglePluginLauncher)}>{t("components.WorkbenchToolbar.text_85ef04ad0c")}<kbd>Alt+Space</kbd></ToolItem>
    <ToolItem icon={PanelRight} active={props.pluginDockOpen} onClick={run(togglePluginDock)}>{t("components.WorkbenchToolbar.text_75288484d2")}</ToolItem>
    <div className="workbench-menu__narrow">
      <ToolItem icon={Search} active={props.quickOpenOpen} onClick={run(props.onToggleQuickOpen)}>Quick Open</ToolItem>
      <ToolItem icon={FileSearch} active={props.previewOpen} onClick={run(props.onTogglePreview)}>{t("components.WorkbenchToolbar.text_4f8ef4d52d")}</ToolItem>
    </div>
    <div className="workbench-menu__divider" />
    <ToolItem icon={Keyboard} active={props.shortcutGuideOpen} onClick={run(props.onOpenShortcutGuide)}>{t("components.WorkbenchToolbar.text_c813e695f2")}</ToolItem>
    <ThemeMenuItem onSelect={props.onSelect} />
  </>;
}

function ThemeToolbarButton() {
  useTranslation();
  const { mode, toggle } = useTheme();
  return <button className="icon-button icon-button--sm workbench-theme" type="button"
    aria-label={mode === "light" ? t("components.WorkbenchToolbar.text_5c00d3bba0") : t("components.WorkbenchToolbar.text_4d107af77a")}
    title={mode === "light" ? t("components.WorkbenchToolbar.text_5c00d3bba0") : t("components.WorkbenchToolbar.text_4d107af77a")} onClick={toggle}>
    {mode === "light" ? <Moon aria-hidden="true" size={ICON.md} /> : <Sun aria-hidden="true" size={ICON.md} />}
  </button>;
}

function ThemeMenuItem({ onSelect }: { onSelect: () => void }) {
  useTranslation();
  const { mode, toggle } = useTheme();
  return <ToolItem icon={mode === "light" ? Moon : Sun} onClick={() => { onSelect(); toggle(); }}>
    {mode === "light" ? t("components.WorkbenchToolbar.text_5c00d3bba0") : t("components.WorkbenchToolbar.text_4d107af77a")}
  </ToolItem>;
}

function ToolItem({ icon: Icon, children, onClick, active, focus }: {
  icon: typeof Search; children: ReactNode; onClick: () => void; active?: boolean; focus?: boolean;
}) {
  useTranslation();
  return <button className="workbench-menu__item" type="button" aria-pressed={active} data-flyout-focus={focus || undefined}
    onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
    <Icon aria-hidden="true" size={ICON.sm} /><span>{children}</span>
  </button>;
}
