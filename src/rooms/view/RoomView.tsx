import { ArrowDown, BrushCleaning, Check, CheckCheck, ChevronRight, CircleHelp, Copy, CornerUpLeft, DoorOpen, Eraser, Undo2, ExternalLink, LoaderCircle, MessageCircleOff, Pencil, Plus, Power, RotateCcw, Search, SendHorizontal, Square, Trash2, UserPlus, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { agentResetCommand, isAgentKind, type AgentKind } from "../../agent/contracts";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Select } from "../../components/controls/Select";
import { useDialog } from "../../components/controls/useDialog";
import { PanelResizeHandle } from "../../panel/PanelResizeHandle";
import { usePanelWidth } from "../../panel/usePanelWidth";
import { ICON } from "../../theme/sizing";
import type { PromptSubmitResult } from "../../prompt/contracts";
import { projectRelativePath } from "../../filepreview/path";
import type { AgentAvailability, ProjectWorkspace } from "../../workspace/contracts";
import { pathKey, shortPath } from "../../workspace/path";
import type { Room, RoomMember, RoomMessage, RoomTabView, RoomTask } from "../contracts";
import { activeRoomTasks, chatDeliveryNote, CONTINUED_WINDOW_MS, deliveryMeta, deliveryRetryable, finishedRoomTasks, formatRoomActivity, formatRoomDay, formatRoomTime, groupReactions, MEMBER_PRESENCE_LABEL, memberName, memberPresence, mentionedMembers, quoteSnippet, splitMentions, splitResultPaths, stageMeta, taskOf, taskRecord } from "../model";
import { ROOM_ASIDE_WIDTH } from "../asideWidth";
import { ROOM_TEMPLATES, resolveTemplateRoles, type RoomTemplate } from "../templates";
import { useRooms, type RoomsController } from "../useRooms";
import { RoomWatch } from "./RoomWatch";
import { composingKey, suppressComposingEnter } from "../../utils/keyboard";
import "./room.css";

interface RoomViewProps {
  agents: AgentAvailability[];
  onClose: () => void;
  /** 独立窗口启动时直接选中这间房；主窗口不传，由房间列表自己选。 */
  initialRoomId?: string;
  /** 打开回执里的文件（相对房间项目根）。独立窗口没有预览面板，不传就按纯文本画。 */
  onOpenFile?: (relativePath: string) => void;
  /** 新建成员会话，返回 tabId；失败返回 null。不传则成员只能在主窗口添加。 */
  onLaunchMember?: (kind: AgentKind, projectRoot: string) => Promise<string | null>;
  /** 关闭成员的会话（进程终止）。不传则房间不提供关闭入口（独立窗口）。 */
  onCloseMemberSession?: (tabId: string) => void;
  /** 清除成员会话的对话上下文：把该 Agent 自己的重置命令送进它的终端。
   *  不传则房间不提供该动作（独立窗口没有终端投递队列）。 */
  onClearMemberContext?: (tabId: string) => PromptSubmitResult;
  /** 在新窗口打开这间房；返回错误信息，null 表示开好了。只有主窗口提供。 */
  onOpenWindow?: (roomId: string, roomName: string) => Promise<string | null>;
  /** 给会话起协作名（创建成员后的引导命名）；返回错误信息，null 表示改成功。 */
  onRenameAgent?: (id: string, raw: string) => string | null;
  project: ProjectWorkspace | null;
  /** 独立窗口：项目归属跟随当前房间；主窗口里仍以应用打开的项目为准。 */
  projectFromRoom?: boolean;
  tabs: RoomTabView[];
}

type RoomLayout = "standard" | "focus" | "compact";
const LAYOUT_KEY = "belfry.rooms.v1.layout";

function readRoomLayout(): RoomLayout {
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    return stored === "focus" || stored === "compact" ? stored : "standard";
  } catch {
    return "standard";
  }
}

type RoomDialog =
  | { kind: "new-room" }
  | { kind: "rename-room" }
  | { kind: "add-member" }
  | { kind: "task"; taskId: string };

type RoomConfirm =
  | { kind: "clear-all-context" }
  | { kind: "clear-chat" }
  | { kind: "clear-context"; member: RoomMember }
  | { kind: "close-member"; member: RoomMember }
  | { kind: "delete-room" }
  | { kind: "recall-message"; message: RoomMessage }
  | { kind: "remove-member"; member: RoomMember }
  | { kind: "stop-task"; task: RoomTask };

/**
 * 协作房间：整窗视图。左边是房间与成员，中间是讨论与派发，右边是任务与决定。
 *
 * 状态真相全在 Rust（见 useRooms 的注释）；这个视图只负责把「谁在、派给谁、
 * 到哪一步了」如实画出来。没有任何自动回复：选中成员发送＝派活，不选＝记录。
 */
export function RoomView(props: RoomViewProps) {
  const rooms = useRooms();
  const [dialog, setDialog] = useState<RoomDialog | null>(null);
  const [confirm, setConfirm] = useState<RoomConfirm | null>(null);
  const [draft, setDraft] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  // @ 点名补全：at = 触发 @ 的下标、query = 已输入的过滤词、index = 键盘高亮的候选。
  const [mention, setMention] = useState<{ at: number; query: string; index: number } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // 「回到底部」浮标攒的条数：翻历史时新消息累计，贴底清零。
  const [belowCount, setBelowCount] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<RoomLayout>(readRoomLayout);

  const room = rooms.room;
  const tabById = useMemo(() => new Map(props.tabs.map((tab) => [tab.id, tab])), [props.tabs]);
  const live = useMemo(() => room?.members.filter((member) => member.leftAt === null) ?? [], [room]);
  // 房间列表按最近活动排序：最近有动静的排最前，沉默的沉底（没说过话的按创建时间）。
  const orderedRooms = useMemo(() => [...rooms.rooms].sort((left, right) =>
    (right.lastMessageAt ?? right.createdAt) - (left.lastMessageAt ?? left.createdAt)), [rooms.rooms]);
  // 输入中的点名（与后端解析同一把尺）：@ 谁就只发给谁，发送按钮据此显示真实投递对象。
  const mentioned = useMemo(() => mentionedMembers(draft, live), [draft, live]);

  // 右栏（「任务与决定」/「看终端」）共用一份可拖宽度；把手挂在整个视图上，
  // 两种形态切换时都钉在同一列左缘，不用各挂一个。
  const asideWidth = usePanelWidth(ROOM_ASIDE_WIDTH);

  // 看谁的终端：存成员 id。会话没了、被移出或换了房间就自动收回，
  // 别把上一间房的画面或一条死会话留在右栏里。
  const [watchId, setWatchId] = useState<string | null>(null);
  const watchMember = useMemo(() => live.find((member) => member.id === watchId) ?? null, [live, watchId]);
  const watchTab = watchMember ? (tabById.get(watchMember.tabId) ?? null) : null;
  useEffect(() => {
    if (watchId && (!watchMember || !watchTab)) setWatchId(null);
  }, [watchId, watchMember, watchTab]);
  useEffect(() => {
    setWatchId(null);
  }, [room?.id]);
  const active = useMemo(() => (room ? activeRoomTasks(room) : []), [room]);
  const finished = useMemo(() => (room ? finishedRoomTasks(room) : []), [room]);
  // 谁正在回复：终端活动信号（talking）直接演成聊天里的「正在回复…」。
  const typing = live.filter((member) => tabById.get(member.tabId)?.activity === "talking");
  const detailTask = room && dialog?.kind === "task" ? taskOf(room, dialog.taskId) ?? null : null;
  // 「清除上下文」确认框要显示具体命令；tab 没了就退回一句通用说明。
  const clearMember = confirm?.kind === "clear-context" ? confirm.member : null;
  const clearTab = clearMember ? tabById.get(clearMember.tabId) : undefined;
  const clearCommand = clearTab && isAgentKind(clearTab.kind) ? agentResetCommand(clearTab.kind) : null;

  // Escape 关整个视图。对话框的 Escape 由 useDialog 在 window 捕获阶段截走并停传播，
  // 到不了这里；这一层只处理「没有任何浮层」的情况。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || composingKey(event)) return;
      props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // 存不下来就只是记不住，不影响这次使用。
    }
  }, [layout]);

  // 换房间清掉草稿、接收者和搜索：在 A 房间写了一半的内容，不该跟着进 B 房间。
  const roomKey = room?.id ?? null;
  useEffect(() => { setDraft(""); setRecipients([]); setQuery(""); setSearchOpen(false); setReplyTo(null); setMention(null); }, [roomKey]);

  // 未读分隔线：进房间时按「上次读到哪」算一次锚点，画在新消息前面。
  // 已读位只在用户点掉分隔线（或在下面发言）时推进——否则首帧就会推平，分隔线会「自己」消失。
  const [unreadAnchor, setUnreadAnchor] = useState<string | null>(null);
  const anchorRef = useRef<string | null>(null);
  const anchoredRoom = useRef<string | null>(null);
  useEffect(() => {
    if (!room || anchoredRoom.current === room.id) return;
    anchoredRoom.current = room.id;
    const stored = readSeenAt(room.id);
    const latest = room.messages[room.messages.length - 1]?.at ?? 0;
    if (stored === null) {
      // 第一次进来：不画分隔线，把已读位定在当前最新。
      writeSeenAt(room.id, latest);
      anchorRef.current = null;
      setUnreadAnchor(null);
      return;
    }
    const first = room.messages.find((message) => message.at > stored);
    anchorRef.current = first?.id ?? null;
    setUnreadAnchor(first?.id ?? null);
  }, [room]);

  const dismissUnread = useCallback(() => {
    if (!anchorRef.current) return;
    anchorRef.current = null;
    setUnreadAnchor(null);
    if (room) writeSeenAt(room.id, room.messages[room.messages.length - 1]?.at ?? Date.now());
  }, [room]);

  // 引用目标：消息可能已被清掉，取不到就退回一句如实说明。
  const replyTarget = replyTo && room ? room.messages.find((message) => message.id === replyTo) ?? null : null;

  // 成员被移出后，已选中的接收者跟着摘掉。
  useEffect(() => {
    setRecipients((current) => {
      const liveIds = new Set(live.map((member) => member.id));
      return current.some((id) => !liveIds.has(id)) ? current.filter((id) => liveIds.has(id)) : current;
    });
  }, [live]);

  // 搜索只筛当前房间的时间线：讨论正文与关联任务标题都算命中。
  const needle = query.trim().toLowerCase();
  const visibleMessages = useMemo(() => {
    if (!room) return [];
    if (!needle) return room.messages;
    return room.messages.filter((message) => {
      // 撤回的消息正文已不可见，就别按它命中——搜到了却看不到原文，只会让人以为出错。
      if (!message.recalledAt && message.text.toLowerCase().includes(needle)) return true;
      const task = message.taskId ? taskOf(room, message.taskId) : undefined;
      return task ? task.title.toLowerCase().includes(needle) : false;
    });
  }, [room, needle]);

  // 时间线跟底：新消息到达时，如果用户本来就贴着底就继续跟；在翻历史或搜索时别拽回去。
  const timelineRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const messageCount = room?.messages.length ?? 0;
  useEffect(() => { pinned.current = true; setBelowCount(0); }, [roomKey]);
  useEffect(() => {
    // 分隔线还挂着：不推已读、也不拽到底——点掉它才算读到。
    if (anchorRef.current) return;
    const node = timelineRef.current;
    const latest = room?.messages[room.messages.length - 1]?.at;
    if (node && pinned.current && !needle) node.scrollTop = node.scrollHeight;
    // 贴着底在看：已读位跟着推进，下次进来才不会把看过的又标成新消息。
    if (room && latest !== undefined && pinned.current && !needle) writeSeenAt(room.id, latest);
  }, [messageCount, roomKey, needle, unreadAnchor]);

  // 「回到底部」浮标（修订十二）：翻历史时新消息不拽人，但把增量攒成条数。
  // 贴着底（跟底已负责）、分隔线挂着（分隔线自己标条数）、搜索中都不重复计数。
  const lastMessageCount = useRef(messageCount);
  useEffect(() => {
    const previous = lastMessageCount.current;
    lastMessageCount.current = messageCount;
    if (messageCount <= previous || pinned.current || anchorRef.current || needle) return;
    setBelowCount((current) => current + (messageCount - previous));
  }, [messageCount, needle]);

  // 重进房间落在第一条未读上：分隔线若在视口外，画了也白画。
  useEffect(() => {
    if (!unreadAnchor) return;
    timelineRef.current?.querySelector(".room-unread")?.scrollIntoView({ block: "start" });
  }, [unreadAnchor]);
  const trackPin = () => {
    const node = timelineRef.current;
    if (!node) return;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    // 自己滚（或拖）回到底部：浮标收起，别举着一枚没用的按钮。
    if (pinned.current) setBelowCount(0);
  };

  // 「回到底部」：点了它＝回到最新；浮标收起、已读位推进（与贴底浏览同一口径）。
  const scrollToBottom = () => {
    const node = timelineRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    pinned.current = true;
    setBelowCount(0);
    if (room && !needle) writeSeenAt(room.id, room.messages[room.messages.length - 1]?.at ?? Date.now());
  };

  const toggleRecipient = (memberId: string) => {
    setRecipients((current) => current.includes(memberId)
      ? current.filter((id) => id !== memberId)
      : [...current, memberId]);
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending || !room) return;
    setSending(true);
    const ok = recipients.length > 0
      ? await rooms.dispatch(text, recipients)
      : live.length > 0
        ? await rooms.broadcast(text, replyTo)
        : await rooms.sendMessage(text, replyTo);
    setSending(false);
    if (ok) {
      setDraft("");
      setRecipients([]);
      setReplyTo(null);
      setMention(null);
      // 在下面发言＝人在场：未读分隔线一并收掉。
      dismissUnread();
      // 发出去的消息要看得见：翻着历史发送也回到最新（真人聊天的习惯——发完落在自己那条上）。
      scrollToBottom();
    }
  };
  // @ 点名补全：候选与后端点名同一把尺——在场成员、按已输入的角色名前缀过滤。
  const mentionCandidates = useMemo(() => (
    mention ? live.filter((member) => member.role.startsWith(mention.query)) : []
  ), [live, mention]);

  const composerChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setDraft(value);
    const caret = event.target.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");
    const query = at >= 0 ? before.slice(at + 1) : "";
    // 查询词里出现换行或第二个 @ 就不再是点名；过滤不到任何人也收起。
    const open = at >= 0 && !/[\n@]/.test(query) && live.length > 0
      && (query === "" || live.some((member) => member.role.startsWith(query)));
    setMention((current) => {
      if (!open) return null;
      const index = current && current.query === query ? current.index : 0;
      return { at, query, index };
    });
  };

  const chooseMention = (member: RoomMember) => {
    if (!mention) return;
    const caret = composerRef.current?.selectionStart ?? draft.length;
    const value = draft.slice(0, mention.at) + `@${member.role} ` + draft.slice(caret);
    const position = mention.at + member.role.length + 2;
    setDraft(value);
    setMention(null);
    // 光标落在刚插入的点名之后，接着打正文。
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(position, position);
    });
  };

  const composerKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法选词的 Enter 是「选中候选词」，不是发送。macOS WKWebView 上这一下
    // 的 compositionend 先于 keydown（WebKit bug 165004），isComposing 已是 false，
    // 只剩 keyCode 229 能认——composingKey 把两种形状一起挡住，漏认就会把半截拼音发出去；
    // 事后 229 的默认动作（会多补一个换行）也一并挡掉。
    if (composingKey(event.nativeEvent)) {
      if (suppressComposingEnter(event.nativeEvent)) event.preventDefault();
      return;
    }
    if (mention && mentionCandidates.length > 0) {
      // 点名单开着：方向键选人；回车 / Tab 选中（这一下不发送）；Escape 只收名单、不关房间。
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setMention((current) => current
          ? { ...current, index: (current.index + step + mentionCandidates.length) % mentionCandidates.length }
          : current);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        chooseMention(mentionCandidates[Math.min(mention.index, mentionCandidates.length - 1)]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMention(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const closeDialog = useCallback(() => setDialog(null), []);

  // 独立窗口没有「应用当前项目」：项目归属就跟着选中的房间走。
  const roomProject = useMemo(() => {
    if (!room) return null;
    if (props.project && pathKey(props.project.rootPath) === pathKey(room.projectRoot)) return props.project;
    return props.projectFromRoom ? projectFromRoot(room.projectRoot) : null;
  }, [props.project, props.projectFromRoom, room]);
  // 建新房的归属：主窗口用「应用打开的项目」；独立窗口退化到当前房间的项目。
  const createProject = props.project ?? roomProject;

  // 独立窗口由 ?room= 直接落在一间房上；列表还没到也没关系，select 随时可调。
  useEffect(() => {
    if (props.initialRoomId) rooms.select(props.initialRoomId);
  }, [props.initialRoomId, rooms.select]);

  const openWindow = async () => {
    if (!room || !props.onOpenWindow) return;
    const failure = await props.onOpenWindow(room.id, room.name);
    if (failure) rooms.reportError(failure);
  };

  // 预览面板跟着当前项目的根走；房间挂在别的项目上时，路径就不开链接，
  // 宁可保持纯文本，也不要打开另一个项目里的同名文件。
  const resolveResultPath = useCallback((candidate: string) => {
    if (!room || !props.onOpenFile || !roomProject) return null;
    return projectRelativePath(room.projectRoot, candidate);
  }, [props.onOpenFile, room, roomProject]);

  return (
    <section aria-label="协作房间" className={`room-view room-view--${layout}${watchMember && watchTab ? " room-view--watching" : ""}`}
      style={{ "--room-aside-width": `${asideWidth.width}px` } as CSSProperties}>
      <aside aria-label="房间与成员" className="room-rail">
        <header className="room-rail__head">
          <h2>协作房间</h2>
          <button aria-label="新建房间" className="icon-button icon-button--sm" disabled={!createProject}
            onClick={() => setDialog({ kind: "new-room" })}
            title={createProject ? "新建房间" : "先在左侧打开一个项目，房间归属项目"} type="button">
            <Plus aria-hidden="true" size={ICON.md} />
          </button>
        </header>
        {rooms.loadError ? <p className="room-rail__notice" role="alert">{rooms.loadError}，房间暂时只读。</p> : null}
        <nav aria-label="房间列表" className="room-list">
          {orderedRooms.map((summary) => {
            // 未读标记与未读分隔线同源：都按每房间本地的已读位算——亮 ⟺ 进房会画分隔线。
            // 没有已读位记录（从未进过这间房）不算未读：首次进房本就不画分隔线，
            // 徽标要是亮了，进房却找不到那条分隔线，两处口径就打架了。
            const seen = readSeenAt(summary.id);
            const unread = seen !== null && summary.lastMessageAt !== null && summary.lastMessageAt > seen;
            return (
              <button aria-current={summary.id === room?.id} className={`room-list__item${summary.id === room?.id ? " is-active" : ""}${unread ? " has-unread" : ""}`}
                key={summary.id} onClick={() => rooms.select(summary.id)}
                title={unread ? `${summary.projectRoot} · 有新消息` : summary.projectRoot} type="button">
                <span className="room-list__title">
                  <span>{summary.name}</span>
                  {unread ? <><i aria-hidden="true" className="room-list__unread" /><span className="sr-only">有新消息</span></> : null}
                </span>
                <small>{summary.memberCount} 人{summary.activeTaskCount > 0 ? ` · ${summary.activeTaskCount} 进行中` : ""}{summary.lastMessageAt !== null ? ` · ${formatRoomActivity(summary.lastMessageAt)}` : ""}</small>
              </button>
            );
          })}
        </nav>
        {room ? (
          <div className="room-members">
            <div className="room-members__head">
              <span>成员 <small>{live.length}</small></span>
              {props.onClearMemberContext && live.length > 0 ? (
                <button aria-label="清除所有成员的上下文" className="icon-button icon-button--sm"
                  onClick={() => setConfirm({ kind: "clear-all-context" })}
                  title="清除所有成员的上下文（每位成员各收到自己的重置命令，开始新会话）" type="button">
                  <BrushCleaning aria-hidden="true" size={ICON.sm} />
                </button>
              ) : null}
              {props.onLaunchMember ? (
                <button aria-label="添加成员" className="icon-button icon-button--sm"
                  onClick={() => setDialog({ kind: "add-member" })} title="添加成员" type="button">
                  <UserPlus aria-hidden="true" size={ICON.sm} />
                </button>
              ) : null}
            </div>
            <ul className="room-member-list">
              {live.map((member) => {
                const tab = tabById.get(member.tabId);
                const presence = memberPresence(tab);
                // 重置命令按 Agent 而定：Pi 没有已知命令时不提供这个动作，宁缺毋假。
                const reset = props.onClearMemberContext && tab && isAgentKind(tab.kind)
                  ? agentResetCommand(tab.kind) : null;
                return (
                  <li className="room-member" key={member.id} title={member.duty ? `${member.role} · ${member.duty}` : member.role}>
                    <i aria-hidden="true" className={`room-member__dot room-member__dot--${presence}`} />
                    <button aria-label={`查看 ${member.role} 的终端`} aria-pressed={watchId === member.id}
                      className="room-member__body" disabled={!tab}
                      onClick={() => setWatchId(watchId === member.id ? null : member.id)}
                      title={tab ? (member.duty ? `${member.duty} · 在房间里看它的终端` : "在房间里看它的终端") : undefined} type="button">
                      <strong>{member.role}</strong>
                      <small>{tab ? `${MEMBER_PRESENCE_LABEL[presence]} · ${tab.kind}` : "会话已不在"}</small>
                    </button>
                    {reset ? (
                      <button aria-label={`清除 ${member.role} 的上下文`} className="icon-button icon-button--sm room-member__remove"
                        onClick={() => setConfirm({ kind: "clear-context", member })}
                        title={`清除上下文（发送 ${reset}，开始新会话）`} type="button">
                        <Eraser aria-hidden="true" size={ICON.xs} />
                      </button>
                    ) : null}
                    {props.onCloseMemberSession && tab ? (
                      <button aria-label={`关闭 ${member.role} 的会话`} className="icon-button icon-button--sm room-member__remove"
                        onClick={() => setConfirm({ kind: "close-member", member })} title="关闭它的会话（结束进程）" type="button">
                        <Power aria-hidden="true" size={ICON.xs} />
                      </button>
                    ) : null}
                    <button aria-label={`把 ${member.role} 移出房间`} className="icon-button icon-button--sm room-member__remove"
                      onClick={() => setConfirm({ kind: "remove-member", member })} title="移出房间" type="button">
                      <X aria-hidden="true" size={ICON.xs} />
                    </button>
                  </li>
                );
              })}
            </ul>
            {live.length === 0 ? (
              <p className="room-rail__hint">{props.onLaunchMember
                ? "还没有成员。点成员栏右上角的＋，选一个 Agent 创建成员。"
                : "还没有成员。成员在应用主窗口里添加，这里专注盯着这一间房。"}</p>
            ) : null}
          </div>
        ) : null}
      </aside>

      <div className="room-stream">
        <header className="room-stream__head">
          {room ? (
            <div className="room-stream__title">
              <strong>{room.name}</strong>
              <small title={[room.projectRoot, ...(room.extraRoots ?? [])].join("\n")}>{roomScopeLabel(room)}</small>
            </div>
          ) : (
            <div className="room-stream__title">
              <strong>协作房间</strong>
              <small>把 Agent 招进房间，之后随时选中它们派活</small>
            </div>
          )}
          <div className="room-stream__actions">
            {room ? (
              <>
                {props.onOpenWindow ? (
                  <button aria-label="在新窗口打开" className="icon-button icon-button--sm"
                    onClick={() => void openWindow()} title="在新窗口打开" type="button">
                    <ExternalLink aria-hidden="true" size={ICON.md} />
                  </button>
                ) : null}
                <div aria-label="房间布局" className="room-layout" role="group">
                  {([["standard", "标准"], ["focus", "专注"], ["compact", "紧凑"]] as const).map(([value, label]) => (
                    <button aria-pressed={layout === value} key={value} onClick={() => setLayout(value)}
                      title={`布局：${label}`} type="button">{label}</button>
                  ))}
                </div>
                <button aria-label="搜索讨论" aria-pressed={searchOpen} className="icon-button icon-button--sm"
                  onClick={() => { setSearchOpen((value) => !value); setQuery(""); }}
                  title="搜索讨论" type="button">
                  <Search aria-hidden="true" size={ICON.md} />
                </button>
                <button aria-label="清空聊天记录" className="icon-button icon-button--sm" disabled={room.messages.length === 0}
                  onClick={() => setConfirm({ kind: "clear-chat" })} title="清空聊天记录（任务、决定与投递记录保留）" type="button">
                  <MessageCircleOff aria-hidden="true" size={ICON.md} />
                </button>
                <button aria-label="重命名房间" className="icon-button icon-button--sm"
                  onClick={() => setDialog({ kind: "rename-room" })} title="重命名房间" type="button">
                  <Pencil aria-hidden="true" size={ICON.md} />
                </button>
                <button aria-label="删除房间" className="icon-button icon-button--sm"
                  onClick={() => setConfirm({ kind: "delete-room" })} title="删除房间" type="button">
                  <Trash2 aria-hidden="true" size={ICON.md} />
                </button>
              </>
            ) : null}
            <button aria-label="关闭协作房间" className="icon-button icon-button--sm"
              onClick={props.onClose} title="关闭协作房间" type="button">
              <X aria-hidden="true" size={ICON.md} />
            </button>
          </div>
        </header>
        {rooms.error ? <p className="room-stream__error" role="alert">{rooms.error}</p> : null}
        {room && searchOpen ? (
          <div className="room-search">
            <Search aria-hidden="true" size={ICON.sm} />
            <input aria-label="搜索讨论" autoFocus onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (composingKey(event.nativeEvent)) return;
                if (event.key === "Escape") {
                  // 这一下只该清搜索或关搜索条；停住传播，别把整个房间视图一起关了。
                  event.preventDefault();
                  event.stopPropagation();
                  if (query) setQuery("");
                  else setSearchOpen(false);
                }
              }}
              placeholder="搜索讨论与任务" value={query} />
            {needle ? <span className="room-search__count">{visibleMessages.length} 条匹配</span> : null}
            <button aria-label="关闭搜索" className="icon-button icon-button--sm"
              onClick={() => { setSearchOpen(false); setQuery(""); }} title="关闭搜索" type="button">
              <X aria-hidden="true" size={ICON.sm} />
            </button>
          </div>
        ) : null}
        {room ? (
          <>
            <div aria-label="房间讨论" className="room-timeline" onScroll={trackPin} ref={timelineRef}>
              {room.messages.length === 0 ? (
                <div className="room-empty room-timeline__empty">
                  <DoorOpen aria-hidden="true" size={ICON.lg} />
                  <p>还没有讨论</p>
                  <small>{room.tasks.length > 0 || room.decisions.length > 0
                    ? "聊天记录已清空；任务、决定与投递记录保留在右侧。"
                    : "在下面写好内容：直接发送＝群聊消息（@ 谁只发给谁）；先选中成员再发＝派活。"}</small>
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="room-empty">
                  <Search aria-hidden="true" size={ICON.lg} />
                  <p>没有匹配的消息</p>
                  <small>换个词试试，或关闭搜索看全部讨论。</small>
                </div>
              ) : visibleMessages.map((message, index) => {
                const prev = index > 0 ? visibleMessages[index - 1] : null;
                const day = formatRoomDay(message.at);
                // 日期分隔与连发合并：同一位作者两分钟内的连续发言收成一段。
                const dayBreak = !prev || formatRoomDay(prev.at) !== day;
                const continued = !dayBreak && prev !== null && prev.kind === message.kind
                  && prev.author === message.author && message.at - prev.at <= CONTINUED_WINDOW_MS;
                return (
                  <Fragment key={message.id}>
                    {dayBreak ? <p className="room-day">{day}</p> : null}
                    {message.id === unreadAnchor && !needle ? (
                      <button className="room-unread" onClick={dismissUnread}
                        title="点掉这条分隔线（即视为读到最新）" type="button">以下为 {visibleMessages.length - index} 条新消息</button>
                    ) : null}
                    <TimelineMessage
                      continued={continued}
                      decisionMarked={room.decisions.some((decision) => decision.messageId === message.id)}
                      message={message}
                      onMarkDecision={(id) => void rooms.markDecision(id)}
                      onOpenFile={props.onOpenFile}
                      onOpenTask={(taskId) => setDialog({ kind: "task", taskId })}
                      onReact={(id, emoji) => void rooms.react(id, emoji)}
                      onRecall={(message) => setConfirm({ kind: "recall-message", message })}
                      onReply={setReplyTo}
                      resolvePath={resolveResultPath}
                      room={room}
                    />
                  </Fragment>
                );
              })}
              {typing.length > 0 ? (
                <p className="room-typing">{typing.map((member) => member.role).join("、")} 正在回复…</p>
              ) : null}
            </div>
            <div className="room-jump">
              {belowCount > 0 && !needle ? (
                <button className="room-jump__button" onClick={scrollToBottom} type="button">
                  <ArrowDown aria-hidden="true" size={ICON.xs} />
                  回到底部 · {belowCount} 条新消息
                </button>
              ) : null}
            </div>
            <div className="room-composer">
              {replyTarget ? (
                <div className="room-reply-banner">
                  <CornerUpLeft aria-hidden="true" size={ICON.xs} />
                  <span>正在回复 {messageAuthor(room, replyTarget)}：{quoteSnippet(replyTarget.text)}</span>
                  <button aria-label="取消回复" onClick={() => setReplyTo(null)} title="取消回复" type="button">
                    <X aria-hidden="true" size={ICON.xs} />
                  </button>
                </div>
              ) : null}
              <div className="room-composer__recipients">
                {live.length === 0 ? (
                  <span className="room-composer__hintline">房间还没有成员，这条只会记进讨论。</span>
                ) : live.map((member) => {
                  const presence = memberPresence(tabById.get(member.tabId));
                  const selected = recipients.includes(member.id);
                  return (
                    <button aria-pressed={selected} className="room-recipient" disabled={presence !== "online"}
                      key={member.id} onClick={() => toggleRecipient(member.id)}
                      title={presence === "online" ? `发给 ${member.role}` : `${member.role}${MEMBER_PRESENCE_LABEL[presence]}，等它空闲再派`} type="button">
                      {selected ? <Check aria-hidden="true" size={ICON.xs} /> : null}
                      {member.role}
                    </button>
                  );
                })}
              </div>
              {mention && mentionCandidates.length > 0 ? (
                <div aria-label="点名成员" className="room-mention" role="listbox">
                  {mentionCandidates.map((member, index) => (
                    <button aria-selected={index === Math.min(mention.index, mentionCandidates.length - 1)} key={member.id}
                      onClick={() => chooseMention(member)}
                      onMouseDown={(event) => event.preventDefault()}
                      role="option" type="button">
                      <strong>@{member.role}</strong>
                      <small>{MEMBER_PRESENCE_LABEL[memberPresence(tabById.get(member.tabId))]}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="room-composer__row">
                <textarea aria-label="房间消息" onChange={composerChange} onKeyDown={composerKey} ref={composerRef}
                  placeholder="写点什么。选中成员后发送＝派任务。" rows={3} value={draft} />
                <button className="room-send" disabled={!draft.trim() || sending} onClick={() => void submit()}
                  title={recipients.length > 0 ? "派发任务" : mentioned.length > 0 ? `只发给被点名的人：${mentioned.map((member) => member.role).join("、")}` : live.length > 0 ? "发到群聊（不派活）" : "记进讨论"} type="button">
                  {sending
                    ? <LoaderCircle aria-hidden="true" className="room-send__spin" size={ICON.sm} />
                    : <SendHorizontal aria-hidden="true" size={ICON.sm} />}
                  {recipients.length > 0 ? `派发（${recipients.length}）` : mentioned.length > 0 ? `发给 ${mentioned.map((member) => member.role).join("、")}` : live.length > 0 ? `发到群聊（${live.length}）` : "记录"}
                </button>
              </div>
              <p className="room-composer__note">直接发送＝群聊消息（@ 谁只发给谁）；先选中成员再发＝派活并跟踪回执</p>
            </div>
          </>
        ) : (
          <div className="room-empty">
            <DoorOpen aria-hidden="true" size={ICON.lg} />
            <p>{rooms.rooms.length > 0 ? "正在读取房间…" : props.project ? "还没有房间" : "先在左侧打开一个项目"}</p>
            <small>{props.project ? "为一个项目拉一个房间，把 Agent 招成成员，之后随时派活。" : "房间归属一个项目；打开项目后就能创建。"}</small>
            {props.project ? (
              <button className="room-empty__cta" onClick={() => setDialog({ kind: "new-room" })} type="button">新建房间</button>
            ) : null}
          </div>
        )}
      </div>

      <aside aria-label="任务与决定" className="room-aside">
        <section className="room-aside__section">
          <h3>进行中 <small>{active.length}</small></h3>
          {!room ? null : active.length === 0 ? (
            <p className="room-aside__empty">没有正在跑的任务</p>
          ) : (
            <ul className="room-task-list">
              {active.map((task) => (
                <li className="room-task" key={task.id}>
                  <button className="room-task__main" onClick={() => setDialog({ kind: "task", taskId: task.id })} type="button">
                    <span className={`room-chip room-chip--${stageMeta(task.stage).tone}`}>{stageMeta(task.stage).label}</span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.deliveries.some((delivery) => delivery.state === "queued" || delivery.state === "dispatched") ? (
                        <LoaderCircle aria-hidden="true" className="room-target__spin" size={ICON.xs} />
                      ) : null}
                      已交差 {task.deliveries.filter((delivery) => delivery.state === "done").length}/{task.deliveries.length} · 第 {task.attempt} 轮
                    </small>
                  </button>
                  <div className="room-task__actions">
                    {task.stage === "dispatching" || task.stage === "running" ? (
                      <button className="room-task__action" onClick={() => setConfirm({ kind: "stop-task", task })} type="button">
                        <Square aria-hidden="true" size={ICON.xs} />停止
                      </button>
                    ) : null}
                    {task.stage === "submitted" ? (
                      <button className="room-task__action" onClick={() => setDialog({ kind: "task", taskId: task.id })} type="button">
                        <Check aria-hidden="true" size={ICON.xs} />验证
                      </button>
                    ) : null}
                    {task.stage === "interrupted" ? (
                      <button className="room-task__action" onClick={() => void rooms.retryTask(task.id)} type="button">
                        <RotateCcw aria-hidden="true" size={ICON.xs} />重新派发
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="room-aside__section">
          <h3>已确认决定 <small>{room?.decisions.length ?? 0}</small></h3>
          {!room || room.decisions.length === 0 ? (
            <p className="room-aside__empty">把拍板的消息记为决定，就会留在这里</p>
          ) : (
            <ul className="room-decision-list">
              {room.decisions.map((decision) => (
                <li className="room-decision" key={decision.id}>
                  <p>{decision.text}</p>
                  <small>{formatRoomTime(decision.at)}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="room-aside__section">
          <h3>已结束 <small>{finished.length}</small></h3>
          {!room || finished.length === 0 ? (
            <p className="room-aside__empty">验证通过、退回、停止与失败的任务会留在这里</p>
          ) : (
            <ul className="room-task-list">
              {finished.map((task) => (
                <li className="room-task room-finished" key={task.id}>
                  <button className="room-task__main" onClick={() => setDialog({ kind: "task", taskId: task.id })} type="button">
                    <span className={`room-chip room-chip--${stageMeta(task.stage).tone}`}>{stageMeta(task.stage).label}</span>
                    <strong>{task.title}</strong>
                    <small>
                      已交差 {task.deliveries.filter((delivery) => delivery.state === "done").length}/{task.deliveries.length} · 第 {task.attempt} 轮
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      {watchMember && watchTab ? (
        <RoomWatch member={watchMember} onClose={() => setWatchId(null)} onOpenFile={props.onOpenFile}
          resolvePath={resolveResultPath} tab={watchTab} />
      ) : null}

      {/* 右栏把手挂在整个视图上（不塞进右栏里）：右栏在「任务与决定」与「看终端」
          间切换，把手不搬位置，靠宽度变量钉在列左缘。 */}
      <PanelResizeHandle label="调整右栏宽度" onCommit={asideWidth.commitWidth} onReset={asideWidth.resetWidth}
        onResize={asideWidth.setWidth} spec={ROOM_ASIDE_WIDTH} width={asideWidth.width} />

      {dialog?.kind === "new-room" && createProject ? (
        <NewRoomDialog agents={props.agents} launchMember={props.onLaunchMember} onCancel={closeDialog}
          onCreated={closeDialog} project={createProject} renameAgent={props.onRenameAgent} rooms={rooms} />
      ) : null}
      {dialog?.kind === "rename-room" && room ? (
        <RenameRoomDialog initial={room.name} onCancel={closeDialog} onRenamed={closeDialog} rooms={rooms} />
      ) : null}
      {dialog?.kind === "add-member" && room && props.onLaunchMember && props.onRenameAgent ? (
        <AddMemberDialog agents={props.agents} launchMember={props.onLaunchMember} onCancel={closeDialog}
          onDone={closeDialog} renameAgent={props.onRenameAgent} room={room} rooms={rooms} />
      ) : null}
      {detailTask && room ? (
        <TaskDialog key={detailTask.id} onCancel={closeDialog} onOpenFile={props.onOpenFile}
          onOpenStop={(task) => { closeDialog(); setConfirm({ kind: "stop-task", task }); }}
          resolvePath={resolveResultPath} room={room} rooms={rooms} task={detailTask} />
      ) : null}

      {confirm?.kind === "delete-room" && room ? (
        <ConfirmDialog
          body="房间的讨论与任务记录会一起删除；还在跑的派发会先停掉。会话本身不受影响。"
          confirmLabel="删除"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); void rooms.deleteRoom(); }}
          title={`删除房间「${room.name}」？`}
        />
      ) : null}
      {confirm?.kind === "close-member" ? (
        <ConfirmDialog
          body="会结束它的会话：进程终止、滚动输出不可恢复，同时把它移出房间。"
          confirmLabel="关闭"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const { member } = confirm;
            setConfirm(null);
            // 先关会话再移出：反过来的话，它会先在侧栏露一下再消失。
            props.onCloseMemberSession?.(member.tabId);
            void rooms.removeMember(member.id);
          }}
          title={`关闭 ${confirm.member.role} 的会话？`}
        />
      ) : null}
      {confirm?.kind === "remove-member" ? (
        <ConfirmDialog
          body="它已经拿到的任务照旧统计；之后的派发不再发给它。会话本身不受影响。"
          confirmLabel="移出"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const { member } = confirm; setConfirm(null); void rooms.removeMember(member.id); }}
          title={`把 ${confirm.member.role} 移出房间？`}
        />
      ) : null}
      {clearMember ? (
        <ConfirmDialog
          body={`会把它的重置命令 ${clearCommand ?? "（按 Agent 而定）"} 送进终端：清空对话上下文、开始新会话。进程、会话与房间身份保持不变；命令排在当前工作之后，等它空闲再送出。`}
          confirmLabel="清除"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const member = clearMember;
            setConfirm(null);
            const result = props.onClearMemberContext?.(member.tabId);
            if (result === "unavailable") {
              rooms.reportError(`「${member.role}」的会话现在收不了指令：不在、已退出，或它的 Agent 没有重置命令。`);
            }
          }}
          title={`清除 ${clearMember.role} 的上下文？`}
        />
      ) : null}
      {confirm?.kind === "clear-all-context" ? (
        <ConfirmDialog
          body="会把每位成员自己的重置命令分别送进它们的终端：清空对话上下文、开始新会话。正忙的成员排队等它空闲；进程、会话与房间身份保持不变。"
          confirmLabel="清除"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            let missed = 0;
            for (const member of live) {
              if (!tabById.has(member.tabId)) { missed += 1; continue; }
              if (props.onClearMemberContext?.(member.tabId) === "unavailable") missed += 1;
            }
            if (missed > 0) {
              rooms.reportError(`有 ${missed} 位成员现在收不了指令（会话不在、已退出，或没有重置命令）。`);
            }
          }}
          title="清除所有成员的上下文？"
        />
      ) : null}
      {confirm?.kind === "clear-chat" ? (
        <ConfirmDialog
          body="时间线上的全部消息会被清掉，之后是干净的空房间；任务、决定与投递记录保留在右栏，成员终端里的对话不受影响。"
          confirmLabel="清空"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); void rooms.clearChat(); }}
          title="清空聊天记录？"
        />
      ) : null}
      {confirm?.kind === "recall-message" ? (
        <ConfirmDialog
          body="时间线上这条会标成已撤回；还没送进成员终端的投递会当场撤掉，成员不会收到。已经进过终端的撤不回来——界面会如实标注。"
          confirmLabel="撤回"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const { message } = confirm; setConfirm(null); void rooms.recall(message.id); }}
          title="撤回这条消息？"
        />
      ) : null}
      {confirm?.kind === "stop-task" ? (
        <ConfirmDialog
          body="已经送进对方终端的指令撤不回来，但它们不会再被计入完成；已有的回执保留。"
          confirmLabel="停止"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const { task } = confirm; setConfirm(null); void rooms.stopTask(task.id); }}
          title="停止这条任务？"
        />
      ) : null}
    </section>
  );
}

/** 弹出的模态统一走 portal 到 body，跟 ConfirmDialog 同一套层管理。 */
function RoomModal({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
  const ref = useDialog(onClose);
  return createPortal(
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div aria-label={label} aria-modal="true" className="modal room-dialog" ref={ref} role="dialog">{children}</div>
    </div>,
    document.body,
  );
}

/** 弹窗里也把最近一次失败摆出来：错误只挂在后面的时间线上时，弹窗没关谁都看不到。 */
function DialogError({ rooms }: { rooms: RoomsController }) {
  useEffect(() => { rooms.clearError(); }, [rooms.clearError]);
  return rooms.error ? <p className="room-dialog__error" role="alert">{rooms.error}</p> : null;
}

function NewRoomDialog({ agents, launchMember, onCancel, onCreated, project, renameAgent, rooms }: {
  agents: AgentAvailability[];
  /** 独立窗口拉不起新会话，不传即隐藏模板（模板的本事就是把成员拉起来）。 */
  launchMember?: (kind: AgentKind, projectRoot: string) => Promise<string | null>;
  onCancel: () => void;
  onCreated: () => void;
  project: ProjectWorkspace;
  renameAgent?: (id: string, raw: string) => string | null;
  rooms: RoomsController;
}) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<RoomTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const roster = template && launchMember ? resolveTemplateRoles(template, agents) : [];
  const pickTemplate = (next: RoomTemplate | null) => {
    setTemplate(next);
    if (next) setName(next.name);
  };
  const submit = async () => {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    const created = await rooms.createRoom(value, project.rootPath);
    if (created) {
      // 模板班子逐个拉起来。任何一步失败就停在这里，房间和已建的成员都保留——
      // 半路回滚会把已经起好的会话丢掉，缺的那个用「添加成员」补更诚实。
      // 独立窗口没有拉起会话的能力，不传 launchMember 时整段跳过。
      if (launchMember) {
        for (const role of roster) {
          const tabId = await launchMember(role.kind, project.rootPath);
          if (!tabId) break;
          const ok = await rooms.addMember(tabId, role.kind, role.role, role.duty, project.rootPath);
          if (!ok) break;
          renameAgent?.(tabId, role.role);
        }
      }
      onCreated();
    }
    setBusy(false);
  };
  return (
    <RoomModal label="新建房间" onClose={onCancel}>
      <strong className="modal__title">新建房间</strong>
      <p className="modal__body">房间归属项目「{project.name}」。成员之后随时可以加，也可以直接用模板建一个常用班子。</p>
      {launchMember ? (
        <div className="room-field">
          <span>模板（选填）</span>
          <div aria-label="房间模板" className="room-segments" role="group">
            <button aria-pressed={template === null} onClick={() => pickTemplate(null)} type="button">不用模板</button>
            {ROOM_TEMPLATES.map((candidate) => (
              <button aria-pressed={template?.id === candidate.id} key={candidate.id}
                onClick={() => pickTemplate(candidate)}
                title={candidate.roles.map((role) => `${role.role}：${role.duty}`).join("\n")} type="button">
                {candidate.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <label className="room-field">
        <span>房间名称</span>
        <input autoFocus maxLength={40} onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (composingKey(event.nativeEvent)) return; if (event.key === "Enter") { event.preventDefault(); void submit(); } }}
          placeholder="如 发布检查" value={name} />
      </label>
      {launchMember && template ? (
        roster.length > 0 ? (
          <div className="room-field">
            <span>创建时会拉起</span>
            <ul className="room-roster">
              {roster.map((role) => <li key={role.role}>{role.role}（{role.agentLabel}）</li>)}
            </ul>
          </div>
        ) : (
          <p className="room-dialog__notice">没有检测到可用的 Agent CLI：先只建房间，成员之后用「添加成员」补。</p>
        )
      ) : null}
      <DialogError rooms={rooms} />
      <div className="modal__actions">
        <button onClick={onCancel} type="button">取消</button>
        <button className="modal__primary" disabled={!name.trim() || busy} onClick={() => void submit()} type="button">创建</button>
      </div>
    </RoomModal>
  );
}

function RenameRoomDialog({ initial, onCancel, onRenamed, rooms }: {
  initial: string; onCancel: () => void; onRenamed: () => void; rooms: RoomsController;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    const ok = await rooms.renameRoom(value);
    setBusy(false);
    if (ok) onRenamed();
  };
  return (
    <RoomModal label="重命名房间" onClose={onCancel}>
      <strong className="modal__title">重命名房间</strong>
      <label className="room-field">
        <span>房间名称</span>
        <input autoFocus maxLength={40} onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (composingKey(event.nativeEvent)) return; if (event.key === "Enter") { event.preventDefault(); void submit(); } }}
          value={name} />
      </label>
      <DialogError rooms={rooms} />
      <div className="modal__actions">
        <button onClick={onCancel} type="button">取消</button>
        <button className="modal__primary" disabled={!name.trim() || busy} onClick={() => void submit()} type="button">保存</button>
      </div>
    </RoomModal>
  );
}

function AddMemberDialog({ agents, launchMember, onCancel, onDone, renameAgent, room, rooms }: {
  agents: AgentAvailability[];
  launchMember: (kind: AgentKind, projectRoot: string) => Promise<string | null>;
  onCancel: () => void;
  onDone: () => void;
  renameAgent: (id: string, raw: string) => string | null;
  room: Room;
  rooms: RoomsController;
}) {
  // 成员一律现拉：选 Agent 就是选「起一条什么样的会话」。不列已有会话——
  // 那些会话属于用户自己的工作现场，把它们拽进房间等于挪走他手边的上下文。
  const launchable = useMemo(() => agents.filter((agent) => agent.available), [agents]);
  const [kind, setKind] = useState<AgentKind>(launchable[0]?.kind ?? "claude");
  const [role, setRole] = useState("");
  const [duty, setDuty] = useState("");
  const [busy, setBusy] = useState(false);
  // Agent 名单是异步到的：对话框先开、名单后到时，选中的那项可能还没上榜。
  const active = launchable.find((agent) => agent.kind === kind) ?? launchable[0] ?? null;
  const blocked = active === null;

  const submit = async () => {
    const roleName = role.trim();
    if (!roleName || busy || !active) return;
    setBusy(true);
    const targetId = await launchMember(active.kind, room.projectRoot);
    if (targetId) {
      const ok = await rooms.addMember(targetId, active.kind, roleName, duty.trim(), room.projectRoot);
      if (ok) {
        // 引导命名：有了协作名，别的 Agent 才寻得到它。角色名不合规就算了——房间内寻址不靠它。
        renameAgent(targetId, roleName);
        onDone();
      }
    }
    setBusy(false);
  };

  return (
    <RoomModal label="添加成员" onClose={onCancel}>
      <strong className="modal__title">添加成员</strong>
      <p className="modal__body">选一个 Agent 创建成员会话：房间里派给成员的任务会直接送进它的终端。</p>
      <div className="room-field">
        <span>Agent</span>
        <Select
          ariaLabel="选择 Agent"
          className="room-select"
          onChange={setKind}
          options={agents.map((agent) => {
            // 已用次数给重复添加一个参照：同一个 Agent 可以再来一位，角色名会自动区分。
            const used = room.members.filter((member) => member.agent === agent.kind).length;
            return {
              value: agent.kind,
              label: agent.descriptor.displayName,
              description: agent.available ? (used > 0 ? `本房间已用 ${used} 次` : undefined) : agent.reason ?? "未检测到",
              disabled: !agent.available,
            };
          })}
          value={active?.kind ?? kind}
        />
      </div>
      {blocked ? <p className="room-dialog__notice">没有检测到可用的 Agent CLI：先在设置里确认装好了，再回来创建。</p> : null}
      <label className="room-field">
        <span>角色名称</span>
        <input autoFocus maxLength={24} onChange={(event) => setRole(event.target.value)}
          onKeyDown={(event) => { if (composingKey(event.nativeEvent)) return; if (event.key === "Enter") { event.preventDefault(); void submit(); } }}
          placeholder="如 前端 / reviewer" value={role} />
      </label>
      <label className="room-field">
        <span>职责（选填）</span>
        <input maxLength={80} onChange={(event) => setDuty(event.target.value)} placeholder="一句话说明它负责什么" value={duty} />
      </label>
      <DialogError rooms={rooms} />
      <div className="modal__actions">
        <button onClick={onCancel} type="button">取消</button>
        <button className="modal__primary" disabled={!role.trim() || busy || blocked} onClick={() => void submit()} type="button">
          {busy ? "创建中…" : "创建"}
        </button>
      </div>
    </RoomModal>
  );
}

function TaskDialog({ onCancel, onOpenFile, onOpenStop, resolvePath, room, rooms, task }: {
  onCancel: () => void;
  /** 独立窗口没有预览面板：为 undefined 时链接根本不会渲染（resolvePath 已拦）。 */
  onOpenFile?: (relativePath: string) => void;
  onOpenStop: (task: RoomTask) => void;
  resolvePath: (candidate: string) => string | null;
  room: Room;
  rooms: RoomsController;
  task: RoomTask;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const meta = stageMeta(task.stage);
  const verify = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await rooms.verifyTask(task.id, note.trim() || undefined);
    setBusy(false);
    if (ok) onCancel();
  };
  const retry = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await rooms.retryTask(task.id);
    setBusy(false);
    if (ok) onCancel();
  };
  const reject = async () => {
    if (busy || !note.trim()) return;
    setBusy(true);
    const ok = await rooms.rejectTask(task.id, note.trim());
    setBusy(false);
    if (ok) onCancel();
  };
  const retryDelivery = async (memberId: string) => {
    if (busy) return;
    setBusy(true);
    // 成功也不关弹窗：这条投递就地变成「排队等对方空闲」，看着它回来。
    await rooms.retryDelivery(task.id, memberId);
    setBusy(false);
  };
  const copyRecord = async () => {
    try {
      await navigator.clipboard.writeText(taskRecord(room, task));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // 剪贴板不给用就保持原样：用户还可以在详情里自己选中文本。
    }
  };
  return (
    <RoomModal label="任务详情" onClose={onCancel}>
      <div className="room-dialog__head">
        <span className={`room-chip room-chip--${meta.tone}`}>{meta.label}</span>
        <small>第 {task.attempt} 轮 · {formatRoomTime(task.createdAt)}</small>
      </div>
      <strong className="modal__title">{task.title}</strong>
      <p className="room-dialog__text">{task.text}</p>
      {task.acceptance.length > 0 ? (
        <div className="room-field">
          <span>验收要点</span>
          <ol className="room-acceptance">
            {task.acceptance.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </div>
      ) : null}
      <div className="room-field">
        <span>投递</span>
        <ul className="room-deliveries">
          {task.deliveries.map((delivery) => {
            const state = deliveryMeta(delivery.state);
            return (
              <li className="room-delivery" key={`${task.id}-${delivery.memberId}-${delivery.at}`}>
                <div className="room-delivery__head">
                  <strong>{memberName(room, delivery.memberId)}</strong>
                  <span className="room-delivery__tail">
                    <span className={`room-chip room-chip--${state.tone}`}>{state.label}</span>
                    {deliveryRetryable(task, delivery) ? (
                      <button aria-label={`重新派给 ${memberName(room, delivery.memberId)}`} className="room-task__action"
                        onClick={() => void retryDelivery(delivery.memberId)} title="把这条投递重新发给他" type="button">
                        <RotateCcw aria-hidden="true" size={ICON.xs} />重派
                      </button>
                    ) : null}
                  </span>
                </div>
                {delivery.result ? (
                  <p className="room-delivery__result">
                    {splitResultPaths(delivery.result).map((segment, index) => {
                      const relative = segment.candidate ? resolvePath(segment.candidate) : null;
                      return relative ? (
                        <button className="room-filelink" key={index} onClick={() => onOpenFile?.(relative)}
                          title={`打开 ${relative}`} type="button">{segment.text}</button>
                      ) : (
                        <span key={index}>{segment.text}</span>
                      );
                    })}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      {task.artifact ? (
        <details className="room-artifact">
          <summary>
            {task.artifact.text.trim()
              ? `证据：工作区差异${task.artifact.truncated ? "（已截断）" : ""}`
              : "证据：交差时工作区没有未提交的改动"}
          </summary>
          {task.artifact.text.trim() ? <pre className="room-artifact__diff">{task.artifact.text}</pre> : null}
        </details>
      ) : null}
      {task.verificationNote ? <p className="room-dialog__notice">验证备注：{task.verificationNote}</p> : null}
      {task.rejectionNote ? <p className="room-dialog__notice">退回说明：{task.rejectionNote}</p> : null}
      {task.stage === "submitted" ? (
        <label className="room-field">
          <span>备注（验证可选，退回必填）</span>
          <input onChange={(event) => setNote(event.target.value)} placeholder="如：已在真机确认，或哪里没通过" value={note} />
        </label>
      ) : null}
      <DialogError rooms={rooms} />
      <div className="modal__actions">
        <button onClick={() => void copyRecord()} title="把这条任务的验证记录复制为纯文本" type="button">
          <Copy aria-hidden="true" size={ICON.sm} />{copied ? "已复制" : "复制记录"}
        </button>
        <button onClick={onCancel} type="button">关闭</button>
        {task.stage === "dispatching" || task.stage === "running" ? (
          <button className="modal__danger" onClick={() => onOpenStop(task)} type="button">
            <Square aria-hidden="true" size={ICON.sm} />停止派发
          </button>
        ) : null}
        {task.stage === "interrupted" ? (
          <button className="modal__primary" disabled={busy} onClick={() => void retry()} type="button">
            <RotateCcw aria-hidden="true" size={ICON.sm} />重新派发
          </button>
        ) : null}
        {task.stage === "submitted" ? (
          <>
            <button disabled={busy || !note.trim()} onClick={() => void reject()}
              title={note.trim() ? "退回重做，并把带反馈的跟进任务立刻派出去" : "先写清哪里没通过，再退回"} type="button">
              <RotateCcw aria-hidden="true" size={ICON.sm} />退回重做
            </button>
            <button className="modal__primary" disabled={busy} onClick={() => void verify()} type="button">
              <Check aria-hidden="true" size={ICON.sm} />验证通过
            </button>
          </>
        ) : null}
      </div>
    </RoomModal>
  );
}

function TimelineMessage({ continued, decisionMarked, message, onMarkDecision, onOpenFile, onOpenTask, onReact, onRecall, onReply, resolvePath, room }: {
  continued: boolean;
  decisionMarked: boolean;
  message: RoomMessage;
  onMarkDecision: (messageId: string) => void;
  onOpenFile?: (relativePath: string) => void;
  onOpenTask: (taskId: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onRecall: (message: RoomMessage) => void;
  onReply: (messageId: string) => void;
  resolvePath: (candidate: string) => string | null;
  room: Room;
}) {
  if (message.kind === "system") {
    return <p className="room-event">{message.text}<time>{formatRoomTime(message.at)}</time></p>;
  }
  // 成员说的话按当前角色名显示：author 存的 memberId，改名后跟新名字走。
  const member = message.kind === "member";
  const author = member ? memberName(room, message.author) : "我";
  const task = message.taskId ? taskOf(room, message.taskId) : undefined;
  const meta = task ? stageMeta(task.stage) : null;
  const quoted = message.replyTo ? room.messages.find((candidate) => candidate.id === message.replyTo) : undefined;
  const reactions = groupReactions(message.reactions);
  return (
    <article className={`room-message${member ? " room-message--member" : " room-message--self"}${continued ? " room-message--continued" : ""}`}
      data-message-id={message.id}>
      <span aria-hidden="true" className="room-avatar"
        style={member ? ({ "--avatar-hue": avatarHue(message.author) } as CSSProperties) : undefined}>
        {Array.from(author)[0] ?? "?"}
      </span>
      <div className="room-message__column">
        <header className="room-message__meta">
          {continued ? null : (
            <>
              <span className="room-message__author">{author}</span>
              <time title={`${formatRoomDay(message.at)} ${formatRoomTime(message.at)}`}>{formatRoomTime(message.at)}</time>
            </>
          )}
          {/* 撤回后这条只剩一条记录：不再给「记为决定 / 回复 / 回应」——对一条撤回了的
              消息做这些动作没有意义，留着按钮只会让人以为还能操作。 */}
          {!message.recalledAt ? (
            <>
              {decisionMarked ? (
                <span className="room-message__marked"><CheckCheck aria-hidden="true" size={ICON.xs} />已记为决定</span>
              ) : (
                <button aria-label="把这条记为决定" className="room-message__mark" onClick={() => onMarkDecision(message.id)}
                  title="把这条记为决定" type="button">
                  <CheckCheck aria-hidden="true" size={ICON.xs} />
                </button>
              )}
              <button aria-label="回复这条" className="room-message__reply" onClick={() => onReply(message.id)}
                title="回复这条" type="button">
                <CornerUpLeft aria-hidden="true" size={ICON.xs} />
              </button>
              {!member && !task ? (
                <button aria-label="撤回这条" className="room-message__recall" onClick={() => onRecall(message)}
                  title="撤回这条（还没送进成员终端的会当场撤掉）" type="button">
                  <Undo2 aria-hidden="true" size={ICON.xs} />
                </button>
              ) : null}
              {(["👍", "✅", "👀"] as const).map((emoji) => (
                <button aria-label={`回应 ${emoji}`} className="room-message__react" key={emoji}
                  onClick={() => onReact(message.id, emoji)} title={`回应 ${emoji}`} type="button">{emoji}</button>
              ))}
            </>
          ) : null}
        </header>
        {quoted ? (
          quoted.recalledAt ? (
            <p className="room-quote room-quote--gone">引用的消息已撤回</p>
          ) : (
            <button className="room-quote" onClick={() => scrollToMessage(quoted.id)} title="跳到这条消息" type="button">
              <strong>{messageAuthor(room, quoted)}</strong>
              <span>{quoteSnippet(quoted.text)}</span>
            </button>
          )
        ) : message.replyTo ? (
          <p className="room-quote room-quote--gone">引用的消息已不在</p>
        ) : null}
        {message.recalledAt ? (
          <div className="room-message__bubble room-message__bubble--recalled">
            <p><Undo2 aria-hidden="true" size={ICON.xs} />已撤回{(message.deliveredTo ?? []).length > 0
              ? "（这条已经进过成员终端，撤不回来）" : ""}</p>
          </div>
        ) : <div className="room-message__bubble"><p>
          {/* 先按 @点名切：点名画成芯片（读对话时一眼看清在叫谁），普通文字再按文件
              路径切一次——能打开的路径画成链接。两把尺拼回去都等于原文。 */}
          {splitMentions(message.text, room.members).map((segment, index) =>
            segment.member ? (
              <span className="room-mention-chip" key={index}>{segment.text}</span>
            ) : (
              splitResultPaths(segment.text).map((part, partIndex) => {
                // 聊天里出现的文件路径同样可点：跟任务回执一套解析与打开路径。
                const relative = part.candidate ? resolvePath(part.candidate) : null;
                return relative ? (
                  <button className="room-filelink" key={`${index}-${partIndex}`} onClick={() => onOpenFile?.(relative)}
                    title={`打开 ${relative}`} type="button">{part.text}</button>
                ) : (
                  <span key={`${index}-${partIndex}`}>{part.text}</span>
                );
              })
            ),
          )}
        </p></div>}
        {reactions.length > 0 && !message.recalledAt ? (
          <div className="room-message__reactions">
            {reactions.map((group) => (
              <button aria-label={`${group.emoji} 回应 ${group.count} 个`} aria-pressed={group.mine}
                className={`room-reaction${group.mine ? " room-reaction--mine" : ""}`} key={group.emoji}
                onClick={() => onReact(message.id, group.emoji)}
                title={group.memberIds.map((id) => (id === "user" ? "我" : memberName(room, id))).join("、")} type="button">
                {group.emoji}<small>{group.count}</small>
              </button>
            ))}
          </div>
        ) : null}
        {message.memberIds.length > 0 && !member && !task && !message.recalledAt ? (
          <p className="room-delivery-note">
            {(message.deliveredTo ?? []).length > 0 ? <Check aria-hidden="true" size={ICON.xs} /> : null}
            {chatDeliveryNote(room, message)}
          </p>
        ) : message.memberIds.length > 0 ? (
          <div className="room-message__targets">
            {message.memberIds.map((memberId) => {
              // 收件人标签就是回执面板：转圈＝还在回，勾＝交差，叉＝失败，问号＝结果未知。
              const state = task?.deliveries.find((delivery) => delivery.memberId === memberId)?.state;
              const stateClass = state === "done" ? " room-target--done"
                : state === "failed" ? " room-target--failed"
                  : state === "queued" || state === "dispatched" ? " room-target--working"
                    : state === "abandoned" || state === "unknown" ? " room-target--gone" : "";
              return (
                <span className={`room-target${stateClass}`} key={memberId}
                  title={state ? `回执：${deliveryMeta(state).label}` : undefined}>
                  {state === "done" ? <Check aria-hidden="true" size={ICON.xs} /> : null}
                  {state === "queued" || state === "dispatched" ? (
                    <LoaderCircle aria-hidden="true" className="room-target__spin" size={ICON.xs} />
                  ) : null}
                  {state === "unknown" ? <CircleHelp aria-hidden="true" size={ICON.xs} /> : null}
                  {state === "failed" || state === "abandoned" ? <X aria-hidden="true" size={ICON.xs} /> : null}
                  {memberName(room, memberId)}
                </span>
              );
            })}
          </div>
        ) : null}
        {task && meta ? (
          <button className="room-taskcard" onClick={() => onOpenTask(task.id)} type="button">
            <span className={`room-chip room-chip--${meta.tone}`}>{meta.label}</span>
            <span className="room-taskcard__title">{task.title}</span>
            <small className="room-taskcard__count">
              {task.deliveries.some((delivery) => delivery.state === "queued" || delivery.state === "dispatched") ? (
                <LoaderCircle aria-hidden="true" className="room-target__spin" size={ICON.xs} />
              ) : null}
              已交差 {task.deliveries.filter((delivery) => delivery.state === "done").length}/{task.deliveries.length}
            </small>
            <ChevronRight aria-hidden="true" size={ICON.sm} />
          </button>
        ) : null}
      </div>
    </article>
  );
}

/** 消息作者显示名：成员按当前角色名解析；系统事件不参与引用。 */
function messageAuthor(room: Room, message: RoomMessage): string {
  if (message.kind === "member") return memberName(room, message.author);
  if (message.kind === "user") return "我";
  return "系统";
}

/** 点引用跳回原消息（原消息可能已被清掉，取不到就什么都不做）。 */
function scrollToMessage(messageId: string) {
  document.querySelector(`[data-message-id="${messageId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
}

/** 每间房的「已读到哪」：重进群时用它画未读分隔线。 */
function readSeenAt(roomId: string): number | null {
  try {
    const raw = localStorage.getItem(`belfry.rooms.v1.seen.${roomId}`);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeSeenAt(roomId: string, at: number) {
  try {
    localStorage.setItem(`belfry.rooms.v1.seen.${roomId}`, String(at));
  } catch {
    // 记不住就下次再画一遍，不影响这次使用。
  }
}

/** 头像底色按作者散列：同一个人的气泡一眼归堆，换人换色但不刺眼。 */
function avatarHue(value: string): number {
  let hue = 0;
  for (const ch of value) hue = (hue * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return hue;
}

/** 独立窗口没有项目清单，用房根还原一个够用的项目对象（名字取路径最后一段）。 */
function projectFromRoot(rootPath: string): ProjectWorkspace {
  const segments = rootPath.split(/[\\/]/).filter(Boolean);
  return { id: rootPath, name: segments[segments.length - 1] ?? rootPath, rootPath, rootUri: "" };
}

/** 房间的项目范围标签：单项目显示路径；扩过多项目后注明总数，全部根进 tooltip。 */
function roomScopeLabel(room: Room): string {
  const extras = room.extraRoots ?? [];
  if (extras.length === 0) return shortPath(room.projectRoot);
  return `${shortPath(room.projectRoot)} 等 ${extras.length + 1} 个项目`;
}
