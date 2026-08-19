import { AlertTriangle, X } from "lucide-react";
import type { HistorySession } from "../history/contracts";
import { HistoryPanel } from "../history/components/HistoryPanel";
import { QuickOpen } from "../quickopen/QuickOpen";
import type { QuickOpenItem } from "../quickopen/model";
import { SettingsPanel } from "../settings/SettingsPanel";
import { ShortcutGuide } from "../shortcuts/ShortcutGuide";
import type { ShortcutPlatform } from "../shortcuts/resolveShortcut";
import { ICON } from "../theme/sizing";
import { UpdateDialog } from "../updater/UpdateDialog";
import type { UpdaterState } from "../updater/contracts";
import { UsagePanel } from "../usage/components/UsagePanel";
import { closeConfirmBody } from "../workspace/closeConfirm";
import type {
  AgentKind,
  AppFailure,
  ProjectWorkspace,
  RecentProject,
  WorkspaceTab,
} from "../workspace/contracts";
import { failureLabel } from "../workspace/errors";
import { removeRecentConfirmBody } from "../workspace/removeRecentConfirm";
import { ConfirmDialog } from "./ConfirmDialog";

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
  onCloseUpdater: () => void;
  onCloseUsage: () => void;
  onConfirmClose: () => void;
  onConfirmRemove: () => void;
  onDismissFailure: () => void;
  onInstallUpdate: () => void;
  onResumeHistory: (kind: AgentKind, session: HistorySession) => void;
  onSelectQuickOpen: (item: QuickOpenItem) => void;
}

export function AppOverlays(props: AppOverlaysProps) {
  return (
    <>
      {props.settingsOpen ? <SettingsPanel onClose={props.onCloseSettings} /> : null}

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

      {props.failure ? <FailureToast failure={props.failure} onClose={props.onDismissFailure} /> : null}

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
