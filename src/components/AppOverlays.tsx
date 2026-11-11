import { t, useTranslation } from "../i18n";
import { AlertTriangle, X } from "lucide-react";
import type { AgentAvailability, AgentKind } from "../agent/contracts";
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
import type { PausedDelivery } from "../prompt/runtime";
import type { TerminalCommandTarget } from "../terminal/contracts";
import { Presence } from "./motion/Presence";

const SettingsPanel = createOptionalPanel({ get title() { return t("components.AppOverlays.text_df3d58c7d8"); }, layout: "settings", exportName: "SettingsPanel",
  load: () => import("../settings/SettingsPanel").then((module) => ({ default: module.SettingsPanel })) });
const RoomPanel = createOptionalPanel({ get title() { return t("components.AppOverlays.text_63235691ff"); }, layout: "room", exportName: "RoomView",
  load: () => import("../rooms/view/RoomView").then((module) => ({ default: module.RoomView })) });
const HistoryPanel = createOptionalPanel({ get title() { return t("components.AppOverlays.text_0eccd0db7b"); }, layout: "history", width: HISTORY_WIDTH, exportName: "HistoryPanel",
  load: () => import("../history/components/HistoryPanel").then((module) => ({ default: module.HistoryPanel })) });
const UsagePanel = createOptionalPanel({ get title() { return t("components.AppOverlays.text_42723e8b49"); }, layout: "usage", width: USAGE_WIDTH, exportName: "UsagePanel",
  load: () => import("../usage/components/UsagePanel").then((module) => ({ default: module.UsagePanel })) });
const QuickOpen = createOptionalPanel({ title: "Quick Open", layout: "modal", exportName: "QuickOpen",
  load: () => import("../quickopen/QuickOpen").then((module) => ({ default: module.QuickOpen })) });
const ShortcutGuide = createOptionalPanel({ get title() { return t("components.AppOverlays.text_c813e695f2"); }, layout: "modal", exportName: "ShortcutGuide",
  load: () => import("../shortcuts/ShortcutGuide").then((module) => ({ default: module.ShortcutGuide })) });
const UpdateDialog = createOptionalPanel({ get title() { return t("components.AppOverlays.text_64c230d225"); }, layout: "modal", exportName: "UpdateDialog",
  load: () => import("../updater/UpdateDialog").then((module) => ({ default: module.UpdateDialog })) });

interface AppOverlaysProps {
  agents: AgentAvailability[];
  failure: AppFailure | null;
  historyOpen: boolean;
  pendingClose: WorkspaceTab | null;
  pendingRemove: RecentProject | null;
  pendingRemoveTabCount: number;
  project: ProjectWorkspace | null;
  quickOpenItems: readonly QuickOpenItem[];
  quickOpenOpen: boolean;
  quickOpenShortcut: string;
  roomsOpen: boolean;
  settingsOpen: boolean;
  settingsSection?: string;
  shortcutGuideOpen: boolean;
  shortcutPlatform: ShortcutPlatform;
  tabs: WorkspaceTab[];
  updaterOpen: boolean;
  updaterState: UpdaterState;
  usageOpen: boolean;
  onCancelClose: () => void;
  onCancelRemove: () => void;
  onCheckUpdate: () => void;
  onCloseHistory: () => void;
  onCloseQuickOpen: () => void;
  onCloseRooms: () => void;
  onCloseSettings: () => void;
  onCloseShortcutGuide: () => void;
  onOpenUpdater: () => void;
  onCloseUpdater: () => void;
  onCloseUsage: () => void;
  onConfirmClose: () => void;
  onConfirmRemove: () => void;
  onDismissFailure: () => void;
  onInstallUpdate: () => void;
  onOpenRoomSession: (tabId: string) => void;
  roomInboxEnabled?: boolean;
  onOpenRoomFile: (projectRoot: string, path: string, line: number | null) => void;
  onClearRoomMemberContext: (tabId: string) => boolean;
  onResumeRoomDelivery: (tabId: string) => boolean;
  roomPausedDeliveries: readonly PausedDelivery[];
  terminalTargets: ReadonlyMap<string, TerminalCommandTarget>;
  onLaunchRoomMember: (kind: AgentKind, projectRoot: string) => Promise<string | null>;
  onRenameAgent: (id: string, raw: string) => string | null;
  onResumeHistory: (session: HistorySession) => void;
  onSelectQuickOpen: (item: QuickOpenItem) => void;
}

export function AppOverlays(props: AppOverlaysProps) {
  useTranslation();
  return <>
    <PrimaryPanels {...props} />
    {props.failure ? <FailureToast failure={props.failure} onClose={props.onDismissFailure} /> : null}
    <WorkspaceConfirmations {...props} />
    <UtilityPanels {...props} />
  </>;
}

function PrimaryPanels(props: AppOverlaysProps) {
  useTranslation();
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

      {props.roomsOpen ? (
        <RoomPanel
          agents={props.agents}
          onClose={props.onCloseRooms}
          onLaunchMember={props.onLaunchRoomMember}
          onOpenSession={props.onOpenRoomSession}
          inboxEnabled={props.roomInboxEnabled}
          onOpenFile={props.onOpenRoomFile}
          onClearContext={props.onClearRoomMemberContext}
          onResumeDelivery={props.onResumeRoomDelivery}
          pausedDeliveries={props.roomPausedDeliveries}
          targets={props.terminalTargets}
          onRenameAgent={props.onRenameAgent}
          project={props.project}
          tabs={props.tabs}
        />
      ) : null}

      <Presence open={props.quickOpenOpen}>
        <QuickOpen
          items={props.quickOpenItems}
          onClose={props.onCloseQuickOpen}
          onSelect={props.onSelectQuickOpen}
          shortcutLabel={props.quickOpenShortcut}
        />
      </Presence>

      {props.usageOpen ? (
        <UsagePanel onClose={props.onCloseUsage} project={props.project} />
      ) : null}

      <Presence open={props.historyOpen} drawer>
        <HistoryPanel onClose={props.onCloseHistory} onResume={props.onResumeHistory} />
      </Presence>

    </>
  );
}

function WorkspaceConfirmations(props: AppOverlaysProps) {
  useTranslation();
  return (
    <>
      <Presence open={!!props.pendingClose}>
      {props.pendingClose ? (
        <ConfirmDialog
          body={closeConfirmBody(props.pendingClose)}
          confirmLabel={t("components.AppOverlays.text_3fd47edce4")}
          onCancel={props.onCancelClose}
          onConfirm={props.onConfirmClose}
          title={t("components.AppOverlays.text_5cd3713fdd", { title: props.pendingClose.title })}
        />
      ) : null}
      </Presence>

      <Presence open={!!props.pendingRemove}>
      {props.pendingRemove ? (
        <ConfirmDialog
          body={removeRecentConfirmBody(props.pendingRemove, props.pendingRemoveTabCount)}
          confirmLabel={t("components.AppOverlays.text_2f9daa8289")}
          onCancel={props.onCancelRemove}
          onConfirm={props.onConfirmRemove}
          title={t("components.AppOverlays.text_5caa73305f", { name: props.pendingRemove.name })}
        />
      ) : null}
      </Presence>

    </>
  );
}

function UtilityPanels(props: AppOverlaysProps) {
  useTranslation();
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
  useTranslation();
  return (
    <div className="failure-toast" role="alert">
      <AlertTriangle aria-hidden="true" size={ICON.lg} />
      <p>{failureLabel(failure)}</p>
      <button onClick={onClose} title={t("components.AppOverlays.text_ee618f2d79")} type="button">
        <X aria-hidden="true" size={ICON.sm} />
      </button>
    </div>
  );
}
