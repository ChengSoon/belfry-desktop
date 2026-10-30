import { X } from "lucide-react";
import { useCallback, useMemo } from "react";
import { TerminalViewport } from "../../components/TerminalViewport";
import type { LaunchProfileId, TerminalLaunch } from "../../terminal/contracts";
import { ICON } from "../../theme/sizing";
import type { WorkspaceTab } from "../../workspace/contracts";
import type { RoomMember, RoomTabView } from "../contracts";
import { MEMBER_PRESENCE_LABEL, memberPresence } from "../model";

/** 看终端只借视口渲染，房间不消费回传；给 TerminalViewport 一个稳定引用。 */
const ignoreSnapshot = () => {};

interface RoomWatchProps {
  member: RoomMember;
  /** 主窗口传的是完整 WorkspaceTab；独立窗口只有名册切片，缺的字段按默认来。 */
  tab: RoomTabView;
  onClose: () => void;
  /** 终端里点到的文件（相对房间项目根）；独立窗口没有预览面板，不传就按纯文本画。 */
  onOpenFile?: (relativePath: string) => void;
  /** 把终端给出的路径换算成房间项目下的相对路径；不在范围内返回 null。 */
  resolvePath: (candidate: string) => string | null;
}

/**
 * 房间内嵌的成员终端：不换界面，右边一栏直接看它干活。
 *
 * 挂载时按 tabId 接驳已跑的守护会话（attachment 优先用当前会话号，缺了后端会按
 * 标签回查，不会重新拉起进程）。工作台若正流着同一会话也没关系：后台能被多路
 * 轮询，宿主侧订阅按连接登记，多一路互不挤占（曾经按会话只留一路，看终端一开
 * 就把工作台那一路掐掉，成员行于是冻在「空闲」）；这里收起只断掉自己那路。
 */
export function RoomWatch({ member, tab, onClose, onOpenFile, resolvePath }: RoomWatchProps) {
  const presence = memberPresence(tab);
  const slice = tab as RoomTabView & Partial<WorkspaceTab>;
  const launch = useMemo<TerminalLaunch>(() => ({
    profileId: slice.profileId ?? (`agent:${slice.kind}` as LaunchProfileId),
    cwd: slice.project?.rootUri ?? null,
    tabId: tab.id,
    // 独立窗口只有名册切片，缺协作标志时按成员是怎么拉起的还原（与 App 的
    // launchRoomMember 同一口径）：猜错会让守护按「类型已改变」拒绝接驳。
    collaborationMode: slice.collaborationMode ?? (slice.kind === "codex" || slice.kind === "claude"),
    resumeSessionId: slice.resumeSessionId ?? null,
    ssh: slice.sshTarget ?? null,
    projectLaunch: slice.projectLaunch,
    attachmentId: slice.daemonSessionId ?? slice.restoreSessionId ?? null,
  }), [
    tab.id, slice.daemonSessionId, slice.restoreSessionId, slice.profileId, slice.kind,
    slice.collaborationMode, slice.resumeSessionId, slice.sshTarget, slice.projectLaunch,
    slice.project?.rootUri,
  ]);

  const handleOpenFile = useCallback((path: string) => {
    const relative = resolvePath(path);
    if (relative) onOpenFile?.(relative);
  }, [resolvePath, onOpenFile]);

  return (
    <section aria-label={`${member.role} 的终端`} className="room-watch">
      <header className="room-watch__head">
        <i aria-hidden="true" className={`room-member__dot room-member__dot--${presence}`} />
        <strong>{member.role}</strong>
        <small>{MEMBER_PRESENCE_LABEL[presence]} · {tab.kind}{member.duty ? ` · ${member.duty}` : ""}</small>
        <button aria-label="收起终端" className="icon-button icon-button--sm" onClick={onClose}
          title="收起终端，回到任务与决定" type="button">
          <X aria-hidden="true" size={ICON.sm} />
        </button>
      </header>
      <div className="room-watch__stage">
        {/* 换成员换实例：接驳身份、搜索与滚动状态都该重来；旧实例收起只断自己那一路连接。 */}
        <TerminalViewport focused={false} key={tab.id} launch={launch} onOpenFile={handleOpenFile}
          onSnapshot={ignoreSnapshot} visible />
      </div>
    </section>
  );
}
