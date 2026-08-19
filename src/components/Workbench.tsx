import { FileSearch, Keyboard, MessageSquareText, PanelLeftOpen, Search } from "lucide-react";
import type { PointerEvent, RefObject } from "react";
import { TerminalStage } from "../layout/components/TerminalStage";
import type { DividerFrame, Rect } from "../layout/contracts";
import type { SessionDrag } from "../layout/useSessionDrag";
import { PromptComposer } from "../prompt/PromptComposer";
import type { PromptQueueItem, PromptSubmitResult } from "../prompt/contracts";
import { appShortcutChord, formatShortcutChord, type ShortcutPlatform } from "../shortcuts/resolveShortcut";
import type { TerminalCommandTarget } from "../terminal/contracts";
import { ICON } from "../theme/sizing";
import { ProjectSwitcher } from "../workspace/components/ProjectSwitcher";
import type { ProjectWorkspace, RecentProject, WorkspaceTab } from "../workspace/contracts";
import "../filepreview/filePreviewTrigger.css";
import "./workbench.css";
import type { TerminalSnapshot } from "./TerminalViewport";

interface WorkbenchProps {
  activeProject: ProjectWorkspace | null;
  activeTabId: string | null;
  collapsed: boolean;
  composerOpen: boolean;
  dividers: DividerFrame[];
  drag: SessionDrag | null;
  opening: boolean;
  promptItems: readonly PromptQueueItem[];
  previewOpen: boolean;
  quickOpenOpen: boolean;
  recentProjects: RecentProject[];
  rects: Map<string, Rect>;
  shortcutGuideOpen: boolean;
  shortcutPlatform: ShortcutPlatform;
  split: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  tabs: WorkspaceTab[];
  onCloseComposer: () => void;
  onClosePane: (id: string) => void;
  onDragStart: (id: string, event: PointerEvent) => void;
  onFocus: (id: string) => void;
  onLaunchShell: () => void;
  onOpenFile: (tabId: string, path: string, line: number | null) => void;
  onOpenProject: (path: string | null) => Promise<void>;
  onOpenShortcutGuide: () => void;
  onRegisterTarget: (id: string, target: TerminalCommandTarget | null) => void;
  onRemovePrompt: (id: string) => void;
  onRequestRemove: (project: RecentProject) => void;
  onResize: (path: string, ratio: number) => void;
  onRevealSidebar: () => void;
  onSendPromptNow: (tabId: string) => boolean;
  onSnapshot: (id: string, snapshot: TerminalSnapshot) => void;
  onSubmitPrompt: (tabId: string, text: string) => PromptSubmitResult;
  onToggleComposer: () => void;
  onTogglePreview: () => void;
  onToggleQuickOpen: () => void;
}

export function Workbench(props: WorkbenchProps) {
  const composerShortcut = shortcutLabel(props.shortcutPlatform, "J");
  const quickOpenShortcut = shortcutLabel(props.shortcutPlatform, "K");
  return (
    <section className={`workbench${props.composerOpen ? " has-composer" : ""}`}>
      {props.collapsed ? (
        <button
          className="icon-button icon-button--sm reveal-handle"
          onClick={props.onRevealSidebar}
          title={`展开侧栏 ${shortcutLabel(props.shortcutPlatform, "B")}`}
          type="button"
        >
          <PanelLeftOpen aria-hidden="true" size={ICON.md} />
        </button>
      ) : null}
      <div className="stage-caption">
        <ProjectSwitcher
          onOpen={props.onOpenProject}
          onRequestRemove={props.onRequestRemove}
          opening={props.opening}
          project={props.activeProject}
          recentProjects={props.recentProjects}
        />
      </div>
      <WorkbenchButton
        expanded={props.composerOpen}
        icon={MessageSquareText}
        label="Prompt Composer"
        onClick={props.onToggleComposer}
        protectDismiss
        shortcut={composerShortcut}
        triggerClass="prompt-composer-trigger"
      />
      <WorkbenchButton
        dialog
        expanded={props.quickOpenOpen}
        icon={Search}
        label="Quick Open"
        onClick={props.onToggleQuickOpen}
        shortcut={quickOpenShortcut}
        triggerClass="quick-open-trigger"
      />
      <WorkbenchButton
        dialog
        expanded={props.previewOpen}
        icon={FileSearch}
        label="文件预览"
        onClick={props.onTogglePreview}
        triggerClass="file-preview-trigger"
      />
      <WorkbenchButton
        dialog
        expanded={props.shortcutGuideOpen}
        icon={Keyboard}
        label="快捷指令"
        onClick={props.onOpenShortcutGuide}
        shortcut={shortcutLabel(props.shortcutPlatform, "/")}
        triggerClass="shortcut-help-trigger"
      />
      <TerminalStage
        activeTabId={props.activeTabId}
        dividers={props.dividers}
        drag={props.drag}
        onClosePane={props.onClosePane}
        onCommandTarget={props.onRegisterTarget}
        onDragStart={props.onDragStart}
        onFocus={props.onFocus}
        onOpenFile={props.onOpenFile}
        onResize={props.onResize}
        onSnapshot={props.onSnapshot}
        rects={props.rects}
        split={props.split}
        stageRef={props.stageRef}
        tabs={props.tabs}
      />
      {props.tabs.length === 0 ? <EmptyStage onLaunch={props.onLaunchShell} /> : null}
      {props.composerOpen ? (
        <PromptComposer
          activeTabId={props.activeTabId}
          items={props.promptItems}
          onClose={props.onCloseComposer}
          onRemove={props.onRemovePrompt}
          onSendNow={props.onSendPromptNow}
          onSubmit={props.onSubmitPrompt}
          shortcutLabel={composerShortcut}
          tabs={props.tabs}
        />
      ) : null}
    </section>
  );
}

function WorkbenchButton({
  dialog = false,
  expanded,
  icon: Icon,
  label,
  onClick,
  protectDismiss = false,
  shortcut,
  triggerClass,
}: {
  dialog?: boolean;
  expanded: boolean;
  icon: typeof Search;
  label: string;
  onClick: () => void;
  protectDismiss?: boolean;
  shortcut?: string;
  triggerClass: string;
}) {
  return (
    <button
      aria-expanded={expanded}
      aria-haspopup={dialog ? "dialog" : "true"}
      aria-label={label}
      className={`icon-button icon-button--sm ${triggerClass}`}
      onClick={onClick}
      onMouseDown={protectDismiss ? (event) => event.stopPropagation() : undefined}
      title={shortcut ? `${label} ${shortcut}` : label}
      type="button"
    >
      <Icon aria-hidden="true" size={ICON.md} />
    </button>
  );
}

function EmptyStage({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="empty-stage">
      <button onClick={onLaunch} type="button">打开 Shell</button>
    </div>
  );
}

function shortcutLabel(platform: ShortcutPlatform, key: string) {
  return formatShortcutChord(appShortcutChord(platform, key));
}
