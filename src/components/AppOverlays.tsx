import { AlertTriangle, X } from "lucide-react";
import type { HistorySession } from "../history/contracts";
import { HISTORY_WIDTH } from "../history/historyWidth";
import type { QuickOpenItem } from "../quickopen/model";
import type { ShortcutPlatform } from "../shortcuts/resolveShortcut";
import { ICON } from "../theme/sizing";
import type { UpdaterState } from "../updater/contracts";
import { USAGE_WIDTH } from "../usage/usageWidth";
import { closeConfirmBody } from "../workspace/closeConfirm";
import type {
  AppFailure,
  ProjectWorkspace,
  RecentProject,
  WorkspaceTab,
} from "../workspace/contracts";
import { failureLabel } from "../workspace/errors";
import { removeRecentConfirmBody } from "../workspace/removeRecentConfirm";
import { ConfirmDialog } from "./ConfirmDialog";
import { createOptionalPanel } from "./lazy/OptionalPanel";

const SettingsPanel = createOptionalPanel({ title: "设置", layout: "settings", exportName: "SettingsPanel",
  load: () => import("../settings/SettingsPanel").then((module) => ({ default: module.SettingsPanel })) });
const HistoryPanel = createOptionalPanel({ title: "历史会话", layout: "history", width: HISTORY_WIDTH, exportName: "HistoryPanel",
  load: () => import("../history/components/HistoryPanel").then((module) => ({ default: module.HistoryPanel })) });
const UsagePanel = createOptionalPanel({ title: "用量", layout: "usage", width: USAGE_WIDTH, exportName: "UsagePanel",
  load: () => import("../usage/components/UsagePanel").then((module) => ({ default: module.UsagePanel })) });
const QuickOpen = createOptionalPanel({ title: "Quick Open", layout: "modal", exportName: "QuickOpen",
  load: () => import("../quickopen/QuickOpen").then((module) => ({ default: module.QuickOpen })) });
const ShortcutGuide = createOptionalPanel({ title: "快捷指令", layout: "modal", exportName: "ShortcutGuide",
  load: () => import("../shortcuts/ShortcutGuide").then((module) => ({ default: module.ShortcutGuide })) });
const UpdateDialog = createOptionalPanel({ title: "应用更新", layout: "modal", exportName: "UpdateDialog",
  load: () => import("../updater/UpdateDialog").then((module) => ({ default: module.UpdateDialog })) });

interface AppOverlaysProps {
  failure: AppFailure | null;
  historyOpen: boolean;
  pendingClose: WorkspaceTab | null;
  pendingRemove: RecentProject | null;
  pendingRemoveTabCount: number;
  project: ProjectWorkspace | null;
  quickOpenItems: readonly QuickOpenItem[];
  quickOpenOpen: boolean;
  quickOpenShortcut: string;
  settingsOpen: boolean;
  settingsSection?: string;
  shortcutGuideOpen: boolean;
  shortcutPlatform: ShortcutPlatform;
  updaterOpen: boolean;
  updaterState: UpdaterState;
  usageOpen: boolean;
  onCancelClose: () => void;
  onCancelRemove: () => void;
  onCheckUpdate: () => void;
  onCloseHistory: () => void;
  onCloseQuickOpen: () => void;
  onCloseSettings: () => void;
  onCloseShortcutGuide: () => void;
  onOpenUpdater: () => void;
  onCloseUpdater: () => void;
  onCloseUsage: () => void;
  onConfirmClose: () => void;
  onConfirmRemove: () => void;
  onDismissFailure: () => void;
  onInstallUpdate: () => void;
  onResumeHistory: (session: HistorySession) => void;
  onSelectQuickOpen: (item: QuickOpenItem) => void;
}

export function AppOverlays(props: AppOverlaysProps) {
  return <>
    <PrimaryPanels {...props} />
    {props.failure ? <FailureToast failure={props.failure} onClose={props.onDismissFailure} /> : null}
    <WorkspaceConfirmations {...props} />
    <UtilityPanels {...props} />
  </>;
}

function PrimaryPanels(props: AppOverlaysProps) {
  return (
    <>
      {props.settingsOpen ? (
        <SettingsPanel
          initialSection={props.settingsSection}
          updaterOpen={props.updaterOpen}
          onClose={props.onCloseSettings}
          onOpenUpdater={props.onOpenUpdater}
          project={props.project}
          updaterState={props.updaterState}
        />
      ) : null}

      {props.quickOpenOpen ? (
        <QuickOpen
          items={props.quickOpenItems}
          onClose={props.onCloseQuickOpen}
          onSelect={props.onSelectQuickOpen}
          shortcutLabel={props.quickOpenShortcut}
        />
      ) : null}

      {props.usageOpen ? (
        <UsagePanel onClose={props.onCloseUsage} project={props.project} />
      ) : null}

      {props.historyOpen ? (
        <HistoryPanel onClose={props.onCloseHistory} onResume={props.onResumeHistory} />
      ) : null}

    </>
  );
}

function WorkspaceConfirmations(props: AppOverlaysProps) {
  return (
    <>
      {props.pendingClose ? (
        <ConfirmDialog
          body={closeConfirmBody(props.pendingClose)}
          confirmLabel="关闭"
          onCancel={props.onCancelClose}
          onConfirm={props.onConfirmClose}
          title={`关闭 ${props.pendingClose.title}？`}
        />
      ) : null}

      {props.pendingRemove ? (
        <ConfirmDialog
          body={removeRecentConfirmBody(props.pendingRemove, props.pendingRemoveTabCount)}
          confirmLabel="删除"
          onCancel={props.onCancelRemove}
          onConfirm={props.onConfirmRemove}
          title={`删除 ${props.pendingRemove.name}？`}
        />
      ) : null}

    </>
  );
}

function UtilityPanels(props: AppOverlaysProps) {
  return (
    <>
      {props.updaterOpen ? (
        <UpdateDialog
          onCheck={props.onCheckUpdate}
          onClose={props.onCloseUpdater}
          onInstall={props.onInstallUpdate}
          state={props.updaterState}
        />
      ) : null}

      {props.shortcutGuideOpen ? (
        <ShortcutGuide onClose={props.onCloseShortcutGuide} platform={props.shortcutPlatform} />
      ) : null}
    </>
  );
}

function FailureToast({ failure, onClose }: { failure: AppFailure; onClose: () => void }) {
  return (
    <div className="failure-toast" role="alert">
      <AlertTriangle aria-hidden="true" size={ICON.lg} />
      <p>{failureLabel(failure)}</p>
      <button onClick={onClose} title="关闭错误提示" type="button">
        <X aria-hidden="true" size={ICON.sm} />
      </button>
    </div>
  );
}
