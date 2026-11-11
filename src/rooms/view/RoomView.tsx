import { formatNumber } from "../../i18n";
import { useFeedback, formatDateTime, formatList } from "../../i18n";
import { getLocale, t } from "../../i18n";
import { roomMessageDelivery as deliveryState } from "../deliveryState";
import { useTranslation } from "../../i18n";
import { historyTimeline } from "../history";
import { useRoomHistory } from "../useRoomHistory";
import { RoomHistoryEntry, RoomInformation } from "./RoomHistory";
import { TimelineAnchor } from "./TimelineAnchor";
import {
  AlertTriangle, Archive, BellRing, Check, CheckCheck, CircleCheck, CircleDashed, CircleDot, Clock, Crown, FolderGit2,
  Inbox, Info, ListTodo, MessageSquareReply, MessagesSquare, MoreHorizontal, Network, Paperclip, Pause, Pencil, Play, Plus, RotateCcw, Search, ArrowDown, Eraser,
  SendHorizontal, Settings2, SquareTerminal, Trash2, UserMinus, UserPlus, Users, X,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { createContext, memo, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { isAgentKind, type AgentAvailability, type AgentKind } from "../../agent/contracts";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "../../components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../components/ui/empty";
import { Input } from "../../components/ui/input";
import { Kbd } from "../../components/ui/kbd";
import { Label } from "../../components/ui/label";
import { Progress } from "../../components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Separator } from "../../components/ui/separator";
import { Spinner } from "../../components/ui/spinner";
import { Textarea } from "../../components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Toggle } from "../../components/ui/toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import type { PausedDelivery } from "../../prompt/runtime";
import type { TerminalCommandTarget } from "../../terminal/contracts";
import { pointInsideRect } from "../../terminal/fileDrop";
import { composingKey } from "../../utils/keyboard";
import { toAppFailure } from "../../workspace/errors";
import type { ProjectWorkspace, WorkspaceTab } from "../../workspace/contracts";
import * as api from "../api";
import { clipboardRoomFiles } from "../attachmentApi";
import { MAX_ATTACHMENTS, messageSummary, transferFiles } from "../attachments";
import { firstUnread, isUnread, latestToUser, markSeen, readSeen, useSeenVersion, watchRoom } from "../inbox";
import type { Room, RoomMember, RoomMessage, RoomTask, TaskStatus } from "../contracts";
import {
  activeMembers, awaitingReply, continues, dayKey, dayLabel, DEFAULT_ROSTER, excerpt, findRoomMessage, foremanOf,
  formatTime, hueOf, initialOf, labelOf, MEMBER_STATUS_TEXT as STATUS_TEXT, memberStatus, type MemberStatus, openBlockers, progress, recipientOptions, shortId, STATUS_LABEL, taskColumns,
  titleError, workload, type RosterRow, applyMention, mentionOptions, mentionQuery, type MentionOption,
} from "../model";
import { useRoomAttachments } from "../useRoomAttachments";
import { useRoomDraft } from "../drafts";
import { useRoomProject } from "../useRoomProject";
import { useRooms, type RoomsState } from "../useRooms";
import { useRoomInteractions } from "../useRoomInteractions";
import { AttachmentCard, MessageAttachments } from "./RoomAttachments";
import { RoomFlow } from "./RoomFlow";
import { RoomChoiceCard } from "./RoomChoiceCard";
import { useAttentionLayout } from "./useAttentionLayout";
import { RoomMarkdown } from "./RoomMarkdown";
import { RoomMessagePreview, RoomReplyInbox } from "./RoomReplyInbox";
import { RoleModelDialog } from "./RoleModelDialog";
import "../tailwind.css";
import "./room.css";

export interface RoomViewProps {
  agents: AgentAvailability[];
  project: ProjectWorkspace | null;
  tabs: WorkspaceTab[];
  onClose: () => void;
  /** 以协作模式拉起一条 Agent 会话，返回 tabId；失败返回 null。 */
  onLaunchMember?: (kind: AgentKind, projectRoot: string) => Promise<string | null>;
  /** 给会话起协作名；返回错误理由或 null。 */
  onRenameAgent?: (tabId: string, name: string) => string | null;
  /** 去看某位成员的终端。 */
  onOpenSession?: (tabId: string) => void;
  /** 每条会话的终端入口：读选择框、替你按选项。 */
  targets?: ReadonlyMap<string, TerminalCommandTarget>;
  /** 投递队列里暂停着的会话。 */
  pausedDeliveries?: readonly PausedDelivery[];
  /** 放开某条会话的暂停，后面的消息接着送。 */
  onResumeDelivery?: (tabId: string) => boolean;
  /** 在文件预览里打开房间项目里的一个文件（相对项目根）。 */
  onOpenFile?: (projectRoot: string, path: string, line: number | null) => void;
  /** 清除成员 Agent 的上下文（Claude 的 /clear、Codex 的 /new）。返回是否已经送出或排上队。 */
  onClearContext?: (tabId: string) => boolean;
}

/** 深处的组件（消息正文、成员菜单）要用的外部动作，免得一层层往下传。 */
const RoomActions = createContext<Pick<RoomViewProps, "onOpenFile" | "onClearContext">>({});

type DialogState =
  | { kind: "new-room" }
  | { kind: "add-member" }
  | { kind: "delete-room"; room: Room }
  | { kind: "role-model"; room: Room; member: RoomMember }
  | { kind: "remove-member"; member: RoomMember };

/** 开着的 Radix 浮层：下拉菜单、选择框、提示（popper）与对话框。 */
const OPEN_LAYER = "[data-radix-popper-content-wrapper], [data-slot=dialog-content], [data-slot=alert-dialog-content]";

/** Radix Select 不接受空字符串当选项值；「按默认收件人」用这个占位。 */
const AUTO_RECIPIENT = "__auto";

export function RoomView(props: RoomViewProps) {
  useTranslation();
  const rooms = useRooms();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [compactPanel, setCompactPanel] = useState<"members" | "tasks" | null>(null);
  const room = rooms.room;

  useEffect(() => {
    setDialog((current) => {
      if (current?.kind !== "role-model") return current;
      const member = room?.members.find((member) => member.id === current.member.id && member.leftAt === null);
      return room?.id === current.room.id && member?.tabId === current.member.tabId && member.agent === current.member.agent ? current : null;
    });
  }, [room]);

  // Escape 关整个视图。Radix 的下拉菜单、选择框、提示在 document 捕获阶段处理 Escape，但不 preventDefault；
  // 它们收起时 DOM 还没更新，所以按「此刻有没有浮层开着」判断：开着就只让浮层收起。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || composingKey(event) || dialog) return;
      if (document.querySelector(OPEN_LAYER)) return;
      if (compactPanel) { setCompactPanel(null); return; }
      props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, compactPanel, props.onClose]);

  const [search, setSearch] = useState("");
  useSeenVersion();
  const ordered = useMemo(
    () => [...rooms.rooms].sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)),
    [rooms.rooms, getLocale()],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? ordered.filter((summary) => `${summary.name} ${summary.objective}`.toLowerCase().includes(q)) : ordered;
  }, [ordered, search, getLocale()]);
  const actions = useMemo(() => ({ onOpenFile: props.onOpenFile, onClearContext: props.onClearContext }), [props.onOpenFile, props.onClearContext, getLocale()]);
  const close = () => setDialog(null);
  const canCreate = rooms.loadError === null;

  return (
    <RoomActions.Provider value={actions}>
    <TooltipProvider delayDuration={300}>
      <section aria-label={t("rooms.RoomView.text_63235691ff")} data-room-panel={compactPanel ?? ""}
        className="room-view grid min-h-0 min-w-0 grid-cols-[256px_minmax(0,1fr)_320px] bg-background text-foreground text-sm max-[1080px]:grid-cols-[232px_minmax(0,1fr)_280px]">
        <div className="room-compact-nav">
          <Button aria-expanded={compactPanel === "members"} onClick={() => setCompactPanel(compactPanel === "members" ? null : "members")} size="sm" variant="ghost"><Users />{t("rooms.RoomView.text_39e2b2a360")}</Button>
          <Button aria-expanded={compactPanel === "tasks"} disabled={!room} onClick={() => setCompactPanel(compactPanel === "tasks" ? null : "tasks")} size="sm" variant="ghost"><ListTodo />{t("rooms.RoomView.text_0f45344baf")}</Button>
          <IconButton className="ml-auto" label={t("rooms.RoomView.text_a072161fe7")} onClick={props.onClose}><X /></IconButton>
        </div>
        {compactPanel ? <button aria-label={t("rooms.RoomView.text_e5461f24cd")} className="room-pane-scrim" onClick={() => setCompactPanel(null)} type="button" /> : null}
        <aside className="room-sidebar flex min-h-0 flex-col border-r border-border bg-(--sidebar)">
          <header className="flex h-12 shrink-0 items-center gap-1 px-3">
            <span className="flex-1 text-[15px] font-semibold tracking-tight">{t("rooms.RoomView.text_63235691ff")}</span>
            <IconButton disabled={!canCreate} label={t("rooms.RoomView.text_b88f06080b")}
              onClick={() => setDialog({ kind: "new-room" })}>
              <Plus />
            </IconButton>
            <IconButton label={t("rooms.RoomView.text_a072161fe7")} onClick={props.onClose}><X /></IconButton>
          </header>
          {rooms.loadError ? (
            <p className="mx-3 mb-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning" role="alert">
              {rooms.loadError}
            </p>
          ) : null}
          {ordered.length > 3 ? (
            <div className="relative mx-2 mb-1.5">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label={t("rooms.RoomView.text_155a07483d")} className="h-7 pl-7 text-xs" onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape" && search) { event.preventDefault(); setSearch(""); } }}
                placeholder={t("rooms.RoomView.text_155a07483d")} value={search} />
            </div>
          ) : null}
          <nav aria-label={t("rooms.RoomView.text_b910914041")} className="flex shrink-0 flex-col gap-0.5 overflow-y-auto px-2 pb-2 max-h-[40%]">
            {shown.map((summary) => {
              const active = summary.id === rooms.selectedId;
              const total = summary.doneTasks + summary.openTasks;
              const unread = !active && isUnread(summary);
              return (
                <button aria-current={active} key={summary.id} onClick={() => { rooms.select(summary.id); setCompactPanel(null); }}
                  title={summary.projectRoot} type="button"
                  className={cn(
                    "group flex flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors outline-none",
                    "hover:bg-(--sidebar-hover) focus-visible:ring-2 focus-visible:ring-ring/50",
                    active && "bg-(--sidebar-active) shadow-(--sidebar-active-shadow)",
                  )}>
                  <span className="flex items-center gap-1.5">
                    <span className={cn("truncate font-medium", unread && "font-semibold")}>{summary.name}</span>
                    {summary.paused ? <Pause aria-label={t("rooms.RoomView.text_eb0c326b60")} className="size-3 shrink-0 text-warning" /> : null}
                    {unread ? (
                      <span className="ml-auto size-2 shrink-0 rounded-full bg-primary" title={`${summary.lastToUser?.from}: ${summary.lastToUser?.text}`}>
                        <span className="sr-only">{t("rooms.RoomView.text_44b9780d17")}</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{summary.projectRoot}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Users className="size-3" /> {formatNumber(summary.memberCount)}
                    <ListTodo className="ml-1 size-3" /> {summary.doneTasks}/{formatNumber(total)}
                    {total ? <Progress className="ml-auto h-1 w-12" value={(summary.doneTasks / total) * 100} /> : null}
                  </span>
                </button>
              );
            })}
            {ordered.length > 0 && shown.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">{t("rooms.RoomView.text_8bd555f450", { search: search })}</p>
            ) : null}
            {ordered.length === 0 ? (
              <p className="px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">{t("rooms.RoomView.text_354b8f2e82")}</p>
            ) : null}
          </nav>
          {room ? (
            <MemberList onAdd={() => setDialog({ kind: "add-member" })} onOpenSession={props.onOpenSession}
              onModel={(member) => setDialog({ kind: "role-model", room, member: { ...member } })}
              onRemove={(member) => setDialog({ kind: "remove-member", member })} room={room} rooms={rooms} tabs={props.tabs} />
          ) : null}
        </aside>

        {room ? (
          <>
            <main className="room-main relative flex min-h-0 min-w-0 flex-col">
              <RoomHeader onDelete={() => setDialog({ kind: "delete-room", room })} room={room} rooms={rooms} />
              {room.paused ? (
                <div className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-xs" role="status">
                  <Pause className="size-3.5 shrink-0 text-warning" />
                  <span className="flex-1">{t("rooms.RoomView.text_588f4872c2")}</span>
                  <Button onClick={() => void rooms.run(() => api.roomSetPaused(room.id, false))} size="xs" variant="outline"><Play />{t("rooms.RoomView.text_e0534b8a4e")}</Button>
                </div>
              ) : null}
              <AttentionPanel onOpenSession={props.onOpenSession} onResume={props.onResumeDelivery}
                paused={props.pausedDeliveries ?? []} room={room} tabs={props.tabs} targets={props.targets} />
              <BriefPanel room={room} rooms={rooms} />
              <CenterTabs onOpenSession={props.onOpenSession} room={room} rooms={rooms} tabs={props.tabs} />
            </main>
            <TaskBoard onOpenSession={props.onOpenSession} room={room} rooms={rooms} tabs={props.tabs} />
          </>
        ) : (
          <main className="room-main col-span-2 flex min-h-0 items-center justify-center">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><MessagesSquare /></EmptyMedia>
                <EmptyTitle>{ordered.length ? t("rooms.RoomView.text_96f91aacab") : t("rooms.RoomView.text_a7507e1e8b")}</EmptyTitle>
                <EmptyDescription>
                  {ordered.length
                    ? t("rooms.RoomView.text_ccbc3059b1")
                    : t("rooms.RoomView.text_91ba8a75c7")}
                </EmptyDescription>
              </EmptyHeader>
              {!ordered.length ? (
                <EmptyContent>
                  <Button disabled={!canCreate} onClick={() => setDialog({ kind: "new-room" })}><Plus />{t("rooms.RoomView.text_b88f06080b")}</Button>
                  {!props.project ? <span className="text-xs text-muted-foreground">{t("rooms.new.projectHint")}</span> : null}
                </EmptyContent>
              ) : null}
            </Empty>
          </main>
        )}

        {rooms.error ? (
          <div className="fixed right-4 bottom-4 z-40 flex max-w-md items-start gap-2 rounded-lg border border-destructive/40 bg-popover px-3 py-2.5 text-sm shadow-lg"
            role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span className="flex-1 leading-relaxed">{rooms.error}</span>
            <Button aria-label={t("rooms.RoomView.text_d301bc1258")} className="-my-1 -mr-1" onClick={rooms.dismissError} size="icon-xs" variant="ghost"><X /></Button>
          </div>
        ) : null}

        {dialog?.kind === "new-room" ? (
          <NewRoomDialog agents={props.agents} onClose={close} onLaunchMember={props.onLaunchMember}
            onRenameAgent={props.onRenameAgent} project={props.project} rooms={rooms} />
        ) : null}
        {dialog?.kind === "add-member" && room ? (
          <AddMemberDialog agents={props.agents} onClose={close} onLaunchMember={props.onLaunchMember}
            onRenameAgent={props.onRenameAgent} room={room} rooms={rooms} tabs={props.tabs} />
        ) : null}
        {dialog?.kind === "role-model" && room?.id === dialog.room.id ? (
          <RoleModelDialog key={`${dialog.room.id}:${dialog.member.id}`} room={dialog.room} member={dialog.member} rooms={rooms} onClose={close} />
        ) : null}
        {dialog?.kind === "delete-room" ? (
          <ConfirmDialog body={t("rooms.RoomView.text_91bff70848")}
            confirmLabel={t("rooms.RoomView.text_8486647747")} onCancel={close} open title={t("rooms.RoomView.text_1bb2e45463", { name: dialog.room.name })}
            onConfirm={() => { void rooms.remove(dialog.room.id); close(); }} />
        ) : null}
        {dialog?.kind === "remove-member" && room ? (
          <ConfirmDialog body={t("rooms.RoomView.text_33348a6b6d")}
            confirmLabel={t("rooms.RoomView.text_95861c4b5c")} onCancel={close} open title={t("rooms.RoomView.text_d3168a28c8", { title: dialog.member.title })}
            onConfirm={() => { void rooms.run(() => api.roomRemoveMember(room.id, dialog.member.id)); close(); }} />
        ) : null}
      </section>
    </TooltipProvider>
    </RoomActions.Provider>
  );
}

// ---- 小部件 ----

function IconButton({ label, children, className, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} className={cn("text-muted-foreground hover:text-foreground", className)} size="icon-sm" variant="ghost" {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** 成员头像：角色名首字，按成员 id 散列出固定的颜色。用户用主色。 */
function MemberAvatar({ room, id, size = "default", status }: {
  room: Room; id: string; size?: "sm" | "default"; status?: MemberStatus;
}) {
  useTranslation();
  const member = room.members.find((candidate) => candidate.id === id);
  const label = id === "user" ? t("rooms.RoomView.text_a0c7716669") : initialOf(member?.title ?? "?");
  const style = id === "user" ? undefined : { "--avatar-hue": hueOf(id) } as React.CSSProperties;
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar size={size}>
        <AvatarFallback style={style}
          className={cn("font-semibold", id === "user" ? "bg-primary text-primary-foreground" : "room-avatar")}>
          {label}
        </AvatarFallback>
      </Avatar>
      {status ? (
        <span aria-hidden="true" className={cn(
          "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-(--sidebar)",
          STATUS_DOT[status],
        )} />
      ) : null}
    </span>
  );
}

function ConfirmDialog(props: {
  open: boolean; title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  useTranslation();
  return (
    <AlertDialog onOpenChange={(open) => { if (!open) props.onCancel(); }} open={props.open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("rooms.RoomView.text_2cd0f3be87")}</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm} variant="destructive">{props.confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SectionHeader({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  useTranslation();
  return (
    <header className="flex h-9 shrink-0 items-center gap-2 px-3">
      <span className="text-xs font-semibold tracking-wide text-muted-foreground">{title}</span>
      {count !== undefined ? <span className="text-xs text-muted-foreground/70">{formatNumber(count)}</span> : null}
      <span className="ml-auto flex items-center gap-0.5">{children}</span>
    </header>
  );
}

// ---- 左栏：成员 ----

const STATUS_DOT: Record<MemberStatus, string> = {
  idle: "bg-success",
  busy: "bg-primary animate-pulse",
  waiting: "bg-warning",
  offline: "bg-muted-foreground/40",
};

function MemberList(props: {
  room: Room; rooms: RoomsState; tabs: WorkspaceTab[];
  onAdd: () => void; onRemove: (member: RoomMember) => void; onOpenSession?: (tabId: string) => void;
  onModel: (member: RoomMember) => void;
}) {
  useTranslation();
  const { room, rooms } = props;
  const members = activeMembers(room);
  const { onClearContext } = useContext(RoomActions);
  const [cleared, setCleared] = useState<string | null>(null);
  return (
    <section aria-label={t("rooms.RoomView.text_6e6d6ddbb7")} className="flex min-h-0 flex-1 flex-col border-t border-border">
      <SectionHeader count={members.length} title={t("rooms.RoomView.text_6e6d6ddbb7")}>
        <IconButton label={t("rooms.RoomView.text_ad9737dafd")} onClick={props.onAdd}><UserPlus /></IconButton>
      </SectionHeader>
      <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {members.map((member) => {
          const tab = props.tabs.find((candidate) => candidate.id === member.tabId);
          const status = memberStatus(tab);
          const load = workload(room, member.id);
          const current = room.tasks.find((task) => task.assignee === member.id && task.status === "active");
          return (
            <div key={member.id}
              className={cn(
                "group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-(--sidebar-hover)",
                status === "waiting" && "bg-warning/10 ring-1 ring-warning/40 hover:bg-warning/15",
              )}>
              <MemberAvatar id={member.id} room={room} status={status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="truncate font-medium">{member.title}</span>
                  {member.role === "foreman" ? (
                    <Tooltip>
                      <TooltipTrigger asChild><Crown aria-label={t("rooms.RoomView.text_8153348240")} className="size-3.5 shrink-0 text-warning" /></TooltipTrigger>
                      <TooltipContent>{t("rooms.RoomView.text_0825dfe0f4")}</TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted-foreground" title={current ? `${current.id} ${current.title}` : member.duty || undefined}>
                  <span className={cn(status === "waiting" && "font-medium text-warning")}>{cleared === member.id ? t("rooms.RoomView.text_1fa489c596") : STATUS_TEXT[status]}</span>
                  {current ? <> · <span className="text-foreground/80">{current.id} {current.title}</span></> : member.duty ? <> · {member.duty}</> : null}
                </div>
                {member.modelOverride ? <div className="truncate text-xs text-muted-foreground" title={member.modelOverride}>{t("rooms.roleModel.summary", { model: member.modelOverride })}</div> : null}
              </div>
              {load ? (
                <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums" title={t("rooms.RoomView.text_1d08cac920", { count: load })}>
                  <ListTodo className="size-3" />{load}
                </span>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-label={t("rooms.RoomView.text_b994b06352", { title: member.title })} size="icon-xs" variant="ghost"
                    className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  {isAgentKind(member.agent) || member.modelOverride ? (
                    <DropdownMenuItem onSelect={() => props.onModel(member)}><Settings2 />{t("rooms.roleModel.menu")}</DropdownMenuItem>
                  ) : null}
                  {tab && props.onOpenSession ? (
                    <DropdownMenuItem onSelect={() => props.onOpenSession?.(tab.id)}><SquareTerminal />{t("rooms.RoomView.text_b89a0e4584")}</DropdownMenuItem>
                  ) : null}
                  {tab && onClearContext ? (
                    <DropdownMenuItem onSelect={() => {
                      if (onClearContext(tab.id)) { setCleared(member.id); window.setTimeout(() => setCleared(null), 4000); }
                    }}>
                      <Eraser />{t("rooms.RoomView.text_5c38d831bf")}</DropdownMenuItem>
                  ) : null}
                  {member.role !== "foreman" ? (
                    <DropdownMenuItem onSelect={() => void rooms.run(() => api.roomSetForeman(room.id, member.id))}>
                      <Crown />{t("rooms.RoomView.text_6204fb86cf")}</DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => props.onRemove(member)} variant="destructive"><UserMinus />{t("rooms.RoomView.text_5f0bf4e6b9")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
        {members.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-2 py-2">
            <p className="text-xs leading-relaxed text-muted-foreground">{t("rooms.RoomView.text_8955d288a5")}</p>
            <Button onClick={props.onAdd} size="sm" variant="outline"><UserPlus />{t("rooms.RoomView.text_ad9737dafd")}</Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ---- 中栏：标题 ----

function RoomHeader({ room, rooms, onDelete }: { room: Room; rooms: RoomsState; onDelete: () => void }) {
  const { t } = useTranslation();
  const [information, setInformation] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(room.name);
  const { done, total } = progress(room);
  useEffect(() => setName(room.name), [room.id, room.name]);
  const save = async () => {
    if (name.trim() && name.trim() !== room.name) await rooms.run(() => api.roomRename(room.id, name));
    setEditing(false);
  };
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
      {editing ? (
        <Input aria-label={t("rooms.RoomView.text_9d9f6a08cf")} autoFocus className="h-8 max-w-xs text-[15px] font-semibold" maxLength={40}
          onBlur={() => void save()} onChange={(event) => setName(event.target.value)} value={name}
          onKeyDown={(event) => {
            if (composingKey(event)) return;
            if (event.key === "Enter") void save();
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setName(room.name); setEditing(false); }
          }} />
      ) : (
        <button className="group flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-[15px] font-semibold tracking-tight hover:bg-accent"
          onClick={() => setEditing(true)} title={t("rooms.RoomView.text_b620c44beb")} type="button">
          <span className="truncate">{room.name}</span>
          <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </button>
      )}
      {room.paused ? <Badge className="border-warning/50 text-warning" variant="outline"><Pause />{t("rooms.RoomView.text_eb0c326b60")}</Badge> : null}
      <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" title={room.projectRoot}>
        <FolderGit2 className="size-3.5 shrink-0" />
        <span className="truncate">{room.projectRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? room.projectRoot}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground" title={t("rooms.RoomView.text_f8e2dcf19e")}>
        <Progress className="h-1.5 w-24" value={total ? (done / total) * 100 : 0} />
        <span className="tabular-nums">{done}/{formatNumber(total)}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={t("rooms.RoomView.text_5f6dfbf037")} className="text-muted-foreground" size="icon-sm" variant="ghost"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem data-room-information-open onSelect={() => setInformation(true)}><Info /> {t("rooms.history.information")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil />{t("rooms.RoomView.text_83c37e8a4a")}</DropdownMenuItem>
          {room.paused ? (
            <DropdownMenuItem onSelect={() => void rooms.run(() => api.roomSetPaused(room.id, false))}><Play />{t("rooms.RoomView.text_eb75bd11df")}</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => void rooms.run(() => api.roomSetPaused(room.id, true))}><Pause />{t("rooms.RoomView.text_21583165d3")}</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete} variant="destructive"><Trash2 />{t("rooms.RoomView.text_8486647747")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RoomInformation room={room} open={information} onClose={() => setInformation(false)} />
    </header>
  );
}

// ---- 中栏：需要你处理的事 ----

/**
 * 成员在等你选择、或者发给他的消息卡住了：放在房间最上面，不用切去终端就能处理。
 *
 * 选项是从终端屏幕读出来的。读不准就只给「去终端处理」，绝不猜着替你按。
 */
function AttentionPanel(props: {
  room: Room; tabs: WorkspaceTab[]; paused: readonly PausedDelivery[];
  targets?: ReadonlyMap<string, TerminalCommandTarget>;
  onOpenSession?: (tabId: string) => void; onResume?: (tabId: string) => boolean;
}) {
  useTranslation();
  const { room, tabs, targets } = props;
  const members = activeMembers(room);
  const stuck = members.filter((member) => props.paused.some((item) => item.tabId === member.tabId));
  const { requests, answer } = useRoomInteractions({ room, tabs, targets });
  const id = useId();
  const count = requests.length + stuck.length;
  const layout = useAttentionLayout(room.id, count > 0);
  const names = formatList([...new Set([...requests.map(request => request.member.title), ...stuck.map(member => member.title)])]);
  if (!requests.length && !stuck.length) return null;

  return (
    <section aria-label={t("rooms.RoomView.text_f50a99897d")} className="room-attention" ref={layout.panel}
      data-compact={layout.compact} data-expanded={layout.expanded}>
      <header className="room-attention-heading">
        <BellRing aria-hidden="true" className="size-3.5" />
        <span className="room-attention-label">{t("rooms.RoomView.text_f50a99897d")}</span>
        <span className="room-attention-members" title={names}>{names}</span>
        <span className="room-attention-count" aria-live="polite">{t("rooms.choice.count", { count })}</span>
        <Button className="room-attention-open" size="sm" variant="outline" ref={layout.trigger}
          aria-controls={id} aria-expanded={layout.expanded} onClick={() => layout.expanded ? layout.close(true) : layout.open()}>
          {t("rooms.choice.openRequests")}<ArrowDown aria-hidden="true" />
        </Button>
      </header>
      <div className="room-attention-body" ref={layout.body} id={id} tabIndex={-1}
        role="region" aria-label={t("rooms.choice.requests")}>
      <header className="room-attention-expanded-heading">
        <BellRing aria-hidden="true" className="size-3.5" />
        <span>{t("rooms.choice.count", { count })}</span>
        <Button className="room-attention-close" size="sm" variant="ghost" onClick={() => layout.close(true)}>
          {t("rooms.choice.collapseRequests")}<X aria-hidden="true" />
        </Button>
      </header>
      <div className="room-attention-scroll" tabIndex={0} role="region" aria-label={t("rooms.choice.requests")}
        onFocus={event => {
          const scroll = event.currentTarget, control = event.target;
          if (control === scroll) return;
          // Textareas may reveal only their caret on Tab. Reveal the control
          // inside this scroll area without moving the conversation or focus.
          const area = scroll.getBoundingClientRect(), field = control.getBoundingClientRect();
          const top = area.top + 4, bottom = area.bottom - 4;
          if (field.top < top || field.height > bottom - top) scroll.scrollTop += field.top - top;
          else if (field.bottom > bottom) scroll.scrollTop += field.bottom - bottom;
        }}>
      {requests.map(request => <RoomChoiceCard key={request.key} request={request} onAnswer={answer} onOpenSession={props.onOpenSession}
        avatar={<MemberAvatar id={request.member.id} room={room} size="sm" />} />)}
      {stuck.map((member) => (
        <article className="room-attention-paused" key={`stuck-${member.id}`}>
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1 wrap-anywhere">
            <span className="font-medium">{t("rooms.RoomView.text_77cacdd84c", { title: member.title })}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ml-2 cursor-help text-xs text-muted-foreground underline decoration-dotted underline-offset-2">{t("rooms.RoomView.text_ee2173408f")}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">{t("rooms.RoomView.text_15bfc949bb")}</TooltipContent>
            </Tooltip>
          </span>
          {props.onOpenSession ? (
            <Button onClick={() => props.onOpenSession?.(member.tabId)} size="xs" variant="ghost"><SquareTerminal />{t("rooms.RoomView.text_21d32099c5")}</Button>
          ) : null}
          <Button onClick={() => props.onResume?.(member.tabId)} size="xs"><Play />{t("rooms.RoomView.text_1825931945")}</Button>
        </article>
      ))}
      </div>
      </div>
    </section>
  );
}

// ---- 中栏：需求简报 ----

function BriefPanel({ room, rooms }: { room: Room; rooms: RoomsState }) {
  useTranslation();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState("");
  const [focus, setFocus] = useState("");
  const [constraints, setConstraints] = useState("");
  const start = () => {
    setObjective(room.brief.objective);
    setFocus(room.brief.currentFocus);
    setConstraints(room.brief.constraints.join("\n"));
    setEditing(true);
  };
  useEffect(() => setEditing(false), [room.id]);
  const save = async () => {
    const saved = await rooms.run(() => api.roomUpdateBrief(room.id, {
      objective, focus, constraints: constraints.split("\n").map((line) => line.trim()).filter(Boolean),
    }));
    if (saved) setEditing(false);
  };
  const brief = room.brief;
  return (
    <section aria-label={t("rooms.RoomView.text_3718c91aa2")} data-editing={editing}
      className="room-brief flex min-h-0 min-w-0 shrink-0 flex-col border-b border-border px-4 py-2.5">
      {editing ? (
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <Field id={`${id}-objective`} label={t("rooms.RoomView.text_7011272724")}>
            <Textarea autoFocus className="min-h-16" id={`${id}-objective`} onChange={(event) => setObjective(event.target.value)} rows={3} value={objective} />
          </Field>
          <Field id={`${id}-focus`} label={t("rooms.RoomView.text_ed208ce975")}>
            <Input id={`${id}-focus`} onChange={(event) => setFocus(event.target.value)} value={focus} />
          </Field>
          <Field hint={t("rooms.RoomView.text_3961feeee5")} id={`${id}-constraints`} label={t("rooms.RoomView.text_ba0934c977")}>
            <Textarea className="min-h-12" id={`${id}-constraints`} onChange={(event) => setConstraints(event.target.value)} rows={2} value={constraints} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(false)} size="sm" variant="ghost">{t("rooms.RoomView.text_2cd0f3be87")}</Button>
            <Button disabled={rooms.busy} onClick={() => void save()} size="sm">{t("rooms.RoomView.text_05d1e23aea")}</Button>
          </div>
        </div>
      ) : (
        <BriefSummary brief={brief} key={room.id} onEdit={start} />
      )}
    </section>
  );
}

function BriefSummary({ brief, onEdit }: { brief: Room["brief"]; onEdit: () => void }) {
  useTranslation();
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    if (!expanded) node.scrollTop = 0;
    let frame = 0;
    const measure = () => {
      const longText = [...node.querySelectorAll<HTMLElement>("[data-brief-text]")].some(text =>
        text.scrollHeight > 2 * parseFloat(getComputedStyle(text).lineHeight) + 1);
      const overflow = longText || node.scrollHeight > node.clientHeight + 1;
      setOverflowing(overflow);
      if (!overflow) setExpanded(false);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    document.fonts.addEventListener("loadingdone", schedule);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.fonts.removeEventListener("loadingdone", schedule); };
  }, [brief, expanded]);
  const badge = "min-w-0 max-w-full shrink whitespace-normal text-left [overflow-wrap:anywhere]";
  const text = cn("min-w-0 leading-snug whitespace-pre-wrap", !expanded && "line-clamp-2");
  return (
    <div className="group flex min-h-0 min-w-0 items-start gap-3">
      <div aria-label={expanded ? t("rooms.RoomView.briefDetails") : undefined} id={id} ref={content}
        role={expanded ? "region" : undefined} tabIndex={expanded ? 0 : undefined}
        className={cn("min-h-0 min-w-0 flex-1 self-stretch overflow-x-hidden select-text", expanded ? "overflow-y-auto" : "overflow-y-hidden")}>
        <p data-brief-text className={cn("leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]", !expanded && "line-clamp-2", !brief.objective && "text-muted-foreground")}>
          <span className="mr-2 text-xs font-semibold tracking-wide text-muted-foreground">{t("rooms.RoomView.text_128a7a0366")}</span>
          {brief.objective || t("rooms.RoomView.text_48a319e483")}
        </p>
        {brief.currentFocus || brief.constraints.length ? (
          <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
            {brief.currentFocus ? <Badge className={badge} variant="secondary"><span className={text} data-brief-text>
              {t("rooms.RoomView.text_b3d7d517ef", { currentFocus: brief.currentFocus })}</span></Badge> : null}
            {brief.constraints.map(item => <Badge className={badge} key={item} variant="outline"><span className={text} data-brief-text>{item}</span></Badge>)}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {overflowing || expanded ? (
          <Button aria-controls={id} aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)} size="xs" variant="ghost">
            <ArrowDown className={expanded ? "rotate-180" : undefined} />
            {t(expanded ? "rooms.RoomView.collapseBrief" : "rooms.RoomView.expandBrief")}
          </Button>
        ) : null}
        <Button className="text-muted-foreground opacity-60 group-hover:opacity-100" onClick={onEdit} size="xs" variant="ghost">
          <Pencil />{t("rooms.RoomView.text_0518365699")}</Button>
      </div>
    </div>
  );
}

/** 表单项：标签关联到 `id` 对应的输入（调用方把同一个 id 传给 Input / Textarea / SelectTrigger）。 */
function Field({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: ReactNode }) {
  useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}{hint ? <span className="font-normal text-muted-foreground/70"> ({hint})</span> : null}
      </Label>
      {children}
    </div>
  );
}

// ---- 中栏：对话 / 流程 ----

/**
 * 中栏两个视图：对话（时间线 + 输入框）和流程图（谁派活给谁、谁在做）。
 * 对话不卸载：切去看流程图再切回来，草稿、附件和滚动位置都还在。
 */
function CenterTabs({ room, rooms, tabs, onOpenSession }: {
  room: Room; rooms: RoomsState; tabs: WorkspaceTab[]; onOpenSession?: (tabId: string) => void;
}) {
  useTranslation();
  const [view, setView] = useState<"chat" | "flow">("chat");
  const { store } = useRoomDraft(room.id);
  const active = room.tasks.filter((task) => task.status === "active").length;
  return (
    <Tabs className="flex min-h-0 flex-1 flex-col gap-0" onValueChange={(value) => setView(value as "chat" | "flow")} value={view}>
      <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
        <TabsList className="h-8" variant="line">
          <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="chat"><MessagesSquare />{t("rooms.RoomView.text_6bf6d3f3d6")}</TabsTrigger>
          <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="flow">
            <Network />{t("rooms.RoomView.text_bdd207e8c6")}{active ? <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary tabular-nums">{active}</span> : null}
          </TabsTrigger>
        </TabsList>
        <RoomReplyInbox room={room} onReply={(replyTo) => { store.update({ replyTo }); setView("chat"); }} />
      </div>
      <TabsContent className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden" forceMount value="chat">
        {/* 每间房一份：未读分隔线、回到底部浮标都按进房那一刻算。 */}
        <Timeline active={view === "chat"} key={room.id} room={room} rooms={rooms} />
      </TabsContent>
      <TabsContent className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden" value="flow">
        <RoomFlow onOpenSession={onOpenSession} room={room} tabs={tabs} />
      </TabsContent>
    </Tabs>
  );
}

// ---- 中栏：时间线 ----

function Timeline({ room, rooms, active }: { room: Room; rooms: RoomsState; active: boolean }) {
  const { t } = useTranslation();
  const history = useRoomHistory(room.id);
  const observed = useRef(new Map<string, RoomMessage>());
  if (!history.started) observed.current.clear();
  for (const message of room.messages) observed.current.set(message.id, message);
  const items = historyTimeline(history.entries, [...observed.current.values()], room);
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // 代码滚到底之后，浏览器下一帧才派发 scroll 事件；那时上面可能刚冒出选择卡片、时间线变矮了，
  // 按那一刻量出来会误判成「用户翻上去了」。记下代码滚到的位置，落在这个位置上的事件不算用户滚动。
  const programmatic = useRef<number | null>(null);
  const { draft, store } = useRoomDraft(room.id);
  const replyTo = draft.replyTo;
  const setReplyTo = useMemo(() => (replyTo: RoomMessage | null) => store.update({ replyTo }), [store]);
  // 进房那一刻的已读位：分隔线画在它之后第一条发给你的消息前，在房间里一直留着，换房间才重算。
  const [seenAtOpen] = useState(() => readSeen(room.id));
  const divider = firstUnread(room.messages, seenAtOpen);
  const dividerId = room.messages[divider]?.id;
  // 翻上去看历史时新到的消息数：攒成「回到底部」浮标上的数字。
  const [away, setAway] = useState(false);
  const [awayFrom, setAwayFrom] = useState(0);
  const newer = away ? Math.max(0, room.messages.length - awayFrom) : 0;
  const last = room.messages.at(-1)?.id;
  const loadEarlier = () => {
    pinned.current = false;
    setAway(true);
    setAwayFrom(room.messages.length);
    const first = items.find(item => item.kind === "message");
    void history.pager.loadEarlier(new Set(items.filter(item => item.kind === "message").map(item => item.message.id)), first?.at ?? Infinity);
  };
  // 看到底了，发给你的消息就算读过。
  const latest = latestToUser(room.messages);
  const stick = () => {
    const node = list.current;
    if (!node || !node.clientHeight || !pinned.current) return;
    node.scrollTop = node.scrollHeight;
    programmatic.current = node.scrollTop;
  };
  useEffect(stick, [last, room.id, active]);
  useEffect(() => {
    if (!active || away) return;
    return watchRoom(room.id);
  }, [active, away, room.id]);
  useEffect(() => {
    const node = list.current;
    if (!active || away || !latest || !node) return;
    let frame = 0;
    const target = node.querySelector<HTMLElement>(`[data-room-message-at="${latest}"]`);
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.visibilityState !== "visible" || !document.hasFocus() || !target || !node.clientHeight) return;
        if (node.scrollHeight - node.scrollTop - node.clientHeight >= 40) return;
        const bounds = node.getBoundingClientRect(), message = target.getBoundingClientRect();
        if (message.height > 0 && message.bottom > bounds.top && message.top < bounds.bottom) markSeen(room.id, latest);
      });
    };
    check();
    const observer = new IntersectionObserver(check, { root: node });
    if (target) observer.observe(target);
    node.addEventListener("scroll", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      node.removeEventListener("scroll", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [active, away, latest, room.id]);
  // 贴底的话跟着贴，不让最新消息被挤出视野：上面冒出选择卡片时时间线变矮（盯容器本身），
  // 图片附件晚一步读出来时内容变高（盯里面那层内容）。
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const observer = new ResizeObserver(stick);
    observer.observe(node);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div aria-label={t("rooms.RoomView.text_343516673e")} aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-2 py-3" ref={list} style={{ overflowAnchor: "none" }}
        onScroll={(event) => {
          const node = event.currentTarget;
          if (programmatic.current !== null && Math.abs(node.scrollTop - programmatic.current) < 2) {
            programmatic.current = null;
            return;
          }
          programmatic.current = null;
          // 只记下用户是不是贴着底，不在这里拽回去：触控板一次只滚几个像素，
          // 在底部附近每次都拽回底部的话，就怎么也翻不上去了。
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
          if (pinned.current === away) {
            setAway(!pinned.current);
            setAwayFrom(room.messages.length);
          }
        }}>
        <TimelineAnchor container={list} pinned={pinned} onRestore={top => { programmatic.current = top; }}>
        <div ref={content} className={cn(items.length === 0 && "min-h-full")}>
        <div className="room-history-controls">
          {history.exhausted ? <span data-room-history-end>{t("rooms.history.end")}</span> :
            <Button data-room-history-load disabled={history.loading} onClick={loadEarlier} size="sm" variant="ghost">
              {history.loading ? <Spinner /> : null}{t(history.loading ? "rooms.history.loading" : history.error ? "rooms.history.retry" : "rooms.history.load")}
            </Button>}
          {history.error ? <p role="alert">{history.error}</p> : null}
        </div>
        {items.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Inbox /></EmptyMedia>
              <EmptyTitle>{t("rooms.RoomView.text_e29432d115")}</EmptyTitle>
              <EmptyDescription>{t("rooms.RoomView.text_d366f5b857")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {items.map((item, index) => {
          const previousItem = items[index - 1];
          const previous = previousItem?.kind === "message" ? previousItem.message : undefined;
          if (item.kind === "event") return <div key={item.key} data-timeline-key={item.key}><RoomHistoryEntry item={item} room={room} /></div>;
          const message = item.message;
          const newDay = !previous || dayKey(previous.at) !== dayKey(message.at);
          return (
            <div key={item.key} data-timeline-key={item.key} data-room-message-at={message.at}>
              {newDay ? (
                <div className="my-3 flex items-center gap-3 px-3" role="separator">
                  <Separator className="flex-1" />
                  <span className="text-xs font-medium text-muted-foreground">{dayLabel(message.at)}</span>
                  <Separator className="flex-1" />
                </div>
              ) : null}
              {message.id === dividerId ? (
                <div className="my-2 flex items-center gap-3 px-3" role="separator">
                  <Separator className="flex-1 bg-primary/50" />
                  <span className="text-xs font-semibold text-primary">{t("rooms.RoomView.text_3fc957bf0f")}</span>
                  <Separator className="flex-1 bg-primary/50" />
                </div>
              ) : null}
              {item.historical ? <RoomHistoryEntry item={item} room={room} /> :
                <MessageItem continued={!newDay && message.id !== dividerId && previousItem?.kind === "message" && !previousItem.historical && continues(previous, message)} message={message}
                  onReply={setReplyTo} room={room} rooms={rooms} />}
            </div>
          );
        })}
        </div>
        </TimelineAnchor>
      </div>
      {away ? (
        <div className="pointer-events-none relative h-0">
          <Button className="pointer-events-auto absolute right-5 bottom-3 z-10 rounded-full shadow-md"
            onClick={() => { pinned.current = true; setAway(false); stick(); }} size="sm" variant="secondary">
            <ArrowDown /> {newer ? t("rooms.RoomView.text_04073c67de", { count: newer }) : t("rooms.RoomView.text_2fdb6c4681")}
          </Button>
        </div>
      ) : null}
      <Composer key={room.id} onSent={() => { pinned.current = true; }} replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)} room={room} rooms={rooms} />
    </>
  );
}

interface MessageItemProps {
  room: Room; rooms: RoomsState; message: RoomMessage; continued: boolean; onReply: (message: RoomMessage) => void;
}

/** 只在这条消息、它引用的那条、成员名单或项目变了时重渲染：房间别处的变化（任务板、新消息）不连累整条时间线。 */
const MessageItem = memo(MessageItemView, (a: MessageItemProps, b: MessageItemProps) =>
  a.message === b.message && a.continued === b.continued && a.onReply === b.onReply
  && a.room.id === b.room.id && a.room.members === b.room.members && a.room.projectRoot === b.room.projectRoot
  && a.room.deliveryOutbox === b.room.deliveryOutbox
  && a.rooms.run === b.rooms.run
  && quotedOf(a.room, a.message) === quotedOf(b.room, b.message));

function quotedOf(room: Room, message: RoomMessage) {
  return message.replyTo ? findRoomMessage(room, message.replyTo) : undefined;
}

function MessageItemView({ room, rooms, message, continued, onReply }: MessageItemProps) {
  useTranslation();
  const [showQuoted, setShowQuoted] = useState(false);
  const time = (
    <time className="text-xs text-muted-foreground tabular-nums" dateTime={new Date(message.at).toISOString()}
      title={formatDateTime(message.at, { dateStyle: "full", timeStyle: "medium" })}>
      {formatTime(message.at)}
    </time>
  );
  if (message.kind === "notice") {
    const target = message.to.length ? formatList(message.to.map((id) => labelOf(room, id))) : null;
    return (
      <div className="group flex items-start gap-3 px-3 py-1 text-xs text-muted-foreground">
        <span className="flex w-8 shrink-0 justify-center pt-px"><Info className="size-3.5 opacity-60" /></span>
        <span className="min-w-0 flex-1 leading-relaxed whitespace-pre-wrap">
          {message.text}
          {target ? <span className="ml-1 opacity-70">→ {target}</span> : null}
        </span>
        <span className="opacity-0 transition-opacity group-hover:opacity-100">{time}</span>
      </div>
    );
  }
  const mine = message.by === "user";
  const { onOpenFile } = useContext(RoomActions);
  const openFile = useMemo(
    () => (onOpenFile ? (path: string, line: number | null) => onOpenFile(room.projectRoot, path, line) : undefined),
    [onOpenFile, room.projectRoot, getLocale()],
  );
  const quoted = quotedOf(room, message);
  const awaiting = awaitingReply(message);
  const delivery = deliveryState(room, message);
  const author = room.members.find((member) => member.id === message.by);
  const recipients = formatList(message.to.map((id) => labelOf(room, id)));
  return (
    <article className={cn("room-message group relative flex gap-3 rounded-md px-3 pb-0.5 hover:bg-accent/40", continued ? "pt-0" : "mt-2.5 pt-1")}
      id={`room-message-${message.id}`}>
      <div className="w-8 shrink-0">
        {continued ? (
          <span className="block pt-0.5 text-right text-[10px] text-muted-foreground opacity-0 tabular-nums group-hover:opacity-100">
            {formatTime(message.at)}
          </span>
        ) : <MemberAvatar id={message.by} room={room} />}
      </div>
      <div className="min-w-0 flex-1">
        {!continued ? (
          <header className="flex flex-wrap items-baseline gap-x-2">
            <span className="flex items-center gap-1 font-semibold">
              {labelOf(room, message.by)}
              {author?.role === "foreman" ? <Crown aria-label={t("rooms.RoomView.text_8153348240")} className="size-3.5 text-warning" /> : null}
            </span>
            {recipients ? <span className="text-xs text-muted-foreground">→ {recipients}</span> : null}
            {time}
            <span className="font-mono text-[11px] text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100"
              title={t("rooms.RoomView.text_1025763c19")}>#{shortId(message.id)}</span>
          </header>
        ) : null}
        {message.replyTo ? (
          <blockquote className="mt-1 border-l-2 border-border pl-2.5 text-xs text-muted-foreground">
            {quoted ? <button className="text-left hover:underline" aria-label={t("rooms.RoomView.text_fbdab9a2d3")} onClick={() => setShowQuoted(true)} type="button">
              <span className="font-medium">{labelOf(room, quoted.by)}</span>{": "}{excerpt(messageSummary(quoted), 80)}
            </button> : t("rooms.RoomView.text_a81e37ce50")}
          </blockquote>
        ) : null}
        {message.text ? (
          <RoomMarkdown className={cn(!continued && "mt-0.5")} onOpenFile={openFile} projectRoot={room.projectRoot} text={message.text} />
        ) : null}
        <MessageAttachments attachments={message.attachments} roomId={room.id} />
        {message.mode === "request_reply" || delivery ? (
          <footer className="mt-1.5 flex flex-wrap items-center gap-2">
            {message.mode === "request_reply" ? (
              awaiting.length ? (
                <Badge className="border-warning/50 bg-warning/10 text-warning" variant="outline">
                  <BellRing />{t("rooms.reply.awaiting", { names: formatList(awaiting.map((id) => labelOf(room, id))) })}</Badge>
              ) : message.replyCancelled ? (
                <Badge variant="outline">{t("rooms.RoomView.text_a372c46d20")}</Badge>
              ) : (
                <Badge className="border-success/50 text-success" variant="outline"><CheckCheck />{t("rooms.RoomView.text_96db2cbbde")}</Badge>
              )
            ) : null}
            {delivery ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground" data-room-delivery={message.id} title={delivery.title}>
                {delivery.uncertain ? <AlertTriangle className="size-3.5 text-warning" /> : delivery.pending ? <Clock className="size-3.5" /> : delivery.submitted ? <CheckCheck className="size-3.5 text-success" /> : <X className="size-3.5" />}
                {delivery.label}
              </span>
            ) : null}
          </footer>
        ) : null}
      </div>
      <div className="room-message-actions absolute top-0 right-3 flex -translate-y-1/2 gap-0.5 rounded-md border border-border bg-popover p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button onClick={() => onReply(message)} size="xs" variant="ghost"><MessageSquareReply />{t("rooms.RoomView.text_cf945e21dd")}</Button>
        {mine && awaiting.length ? (
          <Button onClick={() => void rooms.run(() => api.roomCancelReply(room.id, message.id))} size="xs" variant="ghost">{t("rooms.RoomView.text_a67420beaa")}</Button>
        ) : null}
      </div>
      <RoomMessagePreview message={showQuoted ? quoted ?? null : null} room={room} onClose={() => setShowQuoted(false)} onReply={onReply} />
    </article>
  );
}

function Composer(props: { room: Room; rooms: RoomsState; replyTo: RoomMessage | null; onSent: () => void; onCancelReply: () => void }) {
  useTranslation();
  const { room, rooms, replyTo } = props;
  const { draft, store } = useRoomDraft(room.id);
  const { text, ask } = draft;
  const to = draft.to || AUTO_RECIPIENT;
  const setText = (text: string) => store.update({ text });
  const setTo = (to: string) => store.update({ to: to === AUTO_RECIPIENT ? "" : to });
  const setAsk = (ask: boolean) => store.update({ ask });
  const [dragging, setDragging] = useState(false);
  const [checkingPaste, setCheckingPaste] = useState(false);
  // 正在输入的 @名字：弹出成员名单。index 是方向键选中的那一项。
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);
  const mentionList: MentionOption[] = mention ? mentionOptions(room, mention.query) : [];
  const trackMention = (value: string, caret: number) => {
    const found = mentionQuery(value, caret);
    setMention(found ? { ...found, index: 0 } : null);
  };
  const chooseMention = (option: MentionOption) => {
    const field = input.current;
    if (!field || !mention) return;
    const next = applyMention(text, field.selectionStart, mention.start, option.title);
    setText(next.value);
    setMention(null);
    requestAnimationFrame(() => { field.focus(); field.setSelectionRange(next.caret, next.caret); });
  };
  const input = useRef<HTMLTextAreaElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const pasteCount = useRef(0);
  const attachments = useRoomAttachments(room.id);
  const add = useRef(attachments.add);
  add.current = attachments.add;
  const options = recipientOptions(room);
  const noMembers = activeMembers(room).length === 0;
  const blocked = useRef(noMembers);
  blocked.current = noMembers;
  const full = attachments.items.length >= MAX_ATTACHMENTS;
  const busy = rooms.busy || draft.sending || attachments.pending || checkingPaste;
  const canSend = !noMembers && !busy && (text.trim() !== "" || attachments.items.length > 0);
  useEffect(() => { if (replyTo) input.current?.focus(); }, [replyTo]);

  // 拖文件进来：桌面端由原生拖放给出路径（webview 收不到文件的 HTML 拖放事件），浏览器里退回 HTML 拖放。
  // 落点算整个中栏，不必精确拖到输入框上；有对话框、菜单开着时不接。
  useEffect(() => {
    mounted.current = true;
    const zone = host.current?.closest("main") ?? host.current;
    const accepting = () => !blocked.current && !document.querySelector(OPEN_LAYER);
    let stop: Promise<() => void> = Promise.resolve(() => {});
    try {
      stop = getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (!mounted.current) return;
        if (payload.type === "leave") { setDragging(false); return; }
        const bounds = zone?.getBoundingClientRect();
        const inside = !!bounds?.width && pointInsideRect(payload.position.toLogical(window.devicePixelRatio), bounds) && accepting();
        setDragging(inside && payload.type !== "drop");
        if (inside && payload.type === "drop") void add.current(payload.paths);
      }).catch(() => () => {});
    } catch { /* 不在 Tauri 窗口里（浏览器调试）：只用 HTML 拖放。 */ }
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      const ok = accepting();
      event.dataTransfer.dropEffect = ok ? "copy" : "none";
      setDragging(ok);
    };
    const leave = (event: DragEvent) => { if (!zone?.contains(event.relatedTarget as Node | null)) setDragging(false); };
    const drop = (event: DragEvent) => {
      setDragging(false);
      const files = event.dataTransfer ? transferFiles(event.dataTransfer) : [];
      if (!files.length) return;
      event.preventDefault();
      if (accepting()) void add.current(files);
    };
    zone?.addEventListener("dragover", over);
    zone?.addEventListener("dragleave", leave);
    zone?.addEventListener("drop", drop);
    return () => {
      mounted.current = false;
      zone?.removeEventListener("dragover", over);
      zone?.removeEventListener("dragleave", leave);
      zone?.removeEventListener("drop", drop);
      void stop.then((unlisten) => unlisten());
    };
  }, []);

  // 粘贴：截图、浏览器里复制的图片在剪贴板的文件里；从 Finder / 资源管理器复制的文件浏览器拿不到，
  // 要问一下原生剪贴板。都没有文件就按普通文字粘贴。
  const paste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = transferFiles(event.clipboardData);
    const plain = event.clipboardData.getData("text/plain");
    event.preventDefault();
    const field = event.currentTarget;
    const snapshot = { value: field.value, start: field.selectionStart, end: field.selectionEnd };
    const insertText = () => {
      if (!mounted.current || !plain) return;
      // 读原生剪贴板期间若继续打字，保留新内容，在当前光标处插入。
      const unchanged = field.value === snapshot.value;
      const start = unchanged ? snapshot.start : field.selectionStart;
      const end = unchanged ? snapshot.end : field.selectionEnd;
      const value = field.value.slice(0, start) + plain + field.value.slice(end);
      const caret = start + plain.length;
      setText(value);
      requestAnimationFrame(() => { if (mounted.current) field.setSelectionRange(caret, caret); });
    };
    if (files.length) {
      insertText();
      void attachments.add(files);
      return;
    }
    pasteCount.current += 1;
    setCheckingPaste(true);
    try {
      const paths = await clipboardRoomFiles();
      if (!mounted.current) return;
      if (paths.length) await attachments.add(paths);
      else insertText();
    } catch (cause) {
      // 原生文件列表读不出来时，普通文字照样能粘贴。
      insertText();
      if (mounted.current && !plain) attachments.reportError(toAppFailure(cause).message);
    } finally {
      pasteCount.current -= 1;
      if (mounted.current) setCheckingPaste(pasteCount.current > 0);
    }
  };

  const send = async () => {
    if (!canSend || pasteCount.current > 0) return;
    const submission = attachments.beginSend();
    if (!submission) return;
    const recipients = submission.to ? [submission.to] : [];
    const sent = await rooms.run(() => api.roomSay(room.id, submission.text, recipients,
      submission.replyTo?.id ?? null, submission.ask && !submission.replyTo, submission.attachmentIds));
    attachments.finishSend(submission, sent !== null);
    if (sent && mounted.current) props.onSent();
  };

  return (
    <div className="room-composer shrink-0 px-4 pt-1 pb-4">
      <div ref={host} className={cn(
        "group/composer relative rounded-lg border border-input bg-card shadow-xs transition-[border-color,box-shadow]",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30",
        noMembers && "opacity-60",
      )}>
        {replyTo ? (
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
            <MessageSquareReply className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t("rooms.composer.replyPreview", { name: labelOf(room, replyTo.by), message: excerpt(messageSummary(replyTo), 60) })}
            </span>
            <Button aria-label={t("rooms.RoomView.text_d346633d3a")} onClick={props.onCancelReply} size="icon-xs" variant="ghost"><X /></Button>
          </div>
        ) : null}
        <Textarea aria-label={t("rooms.RoomView.text_4da199fae9")} disabled={noMembers} ref={input} rows={2} value={text}
          className="min-h-14 resize-none border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          onChange={(event) => { setText(event.target.value); trackMention(event.target.value, event.target.selectionStart); }}
          onClick={(event) => trackMention(event.currentTarget.value, event.currentTarget.selectionStart)}
          onBlur={() => window.setTimeout(() => setMention(null), 120)}
          onPaste={(event) => void paste(event)}
          placeholder={noMembers ? t("rooms.RoomView.text_2b927253a2")
            : replyTo ? t("rooms.RoomView.text_7852e73a27")
              : t("rooms.RoomView.text_402377e6b0")}
          onKeyDown={(event) => {
            if (composingKey(event)) return;
            if (mention && mentionList.length) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setMention({ ...mention, index: (mention.index + step + mentionList.length) % mentionList.length });
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                chooseMention(mentionList[Math.min(mention.index, mentionList.length - 1)]);
                return;
              }
            }
            if (mention && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMention(null); return; }
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
          }} />
        {mention && mentionList.length ? (
          <div aria-label={t("rooms.RoomView.text_855f3f1677")} className="absolute bottom-full left-2 z-30 mb-1.5 w-80 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg" role="listbox">
            <div className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground">{t("rooms.RoomView.text_5a36033acb")}</div>
            {mentionList.map((option, index) => (
              <button aria-selected={index === mention.index} key={`${option.kind}-${option.title}`} role="option" type="button"
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", index === mention.index ? "bg-accent" : "hover:bg-accent/60")}
                onMouseDown={(event) => { event.preventDefault(); chooseMention(option); }}
                onMouseEnter={() => setMention({ ...mention, index })}>
                {option.kind === "member" ? (
                  <MemberAvatar id={room.members.find((member) => member.title === option.title)?.id ?? option.title} room={room} size="sm" />
                ) : <Users className="size-4 text-muted-foreground" />}
                <span className="font-medium">@{option.title}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{option.description}</span>
              </button>
            ))}
          </div>
        ) : null}
        {attachments.items.length ? (
          <div aria-label={t("rooms.RoomView.text_d630b6745f")} aria-live="polite" className="flex max-h-32 flex-wrap gap-2 overflow-y-auto px-3 pt-1 pb-2.5">
            {attachments.items.map((item) => (
              <AttachmentCard attachment={item.attachment} disabled={rooms.busy} key={item.key} name={item.name}
                onRemove={() => attachments.remove(item.key)} roomId={room.id} size={item.size} />
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button aria-label={t("rooms.RoomView.text_ad9daebe00")} className="size-7 text-muted-foreground hover:text-foreground"
                  disabled={noMembers || full || rooms.busy} onClick={() => void attachments.pick()} size="icon-sm" variant="ghost">
                  <Paperclip />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {full ? t("rooms.RoomView.text_033657b0da", { limit: MAX_ATTACHMENTS }) : t("rooms.RoomView.text_ee873c568a")}
            </TooltipContent>
          </Tooltip>
          <Separator className="mx-0.5 h-4" orientation="vertical" />
          <Select disabled={noMembers || replyTo !== null} onValueChange={setTo} value={to}>
            <SelectTrigger aria-label={t("rooms.RoomView.text_c237b665a6")} className="h-7 max-w-52 gap-1.5 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-accent dark:bg-transparent" size="sm">
              <span className="text-muted-foreground">{t("rooms.RoomView.text_c7378a8741")}</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value || AUTO_RECIPIENT} value={option.value || AUTO_RECIPIENT}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* 包一层 span：按钮禁用时收不到悬停事件，提示就出不来。 */}
              <span className="inline-flex">
                <Toggle aria-label={t("rooms.RoomView.text_4c4ca82910")} disabled={noMembers || replyTo !== null} onPressedChange={setAsk}
                  pressed={ask && !replyTo} size="sm" variant="outline"
                  className={cn(
                    "h-7 gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground shadow-none",
                    "data-[state=on]:border-primary/50 data-[state=on]:bg-primary/15 data-[state=on]:text-primary",
                    "hover:data-[state=on]:bg-primary/20 hover:data-[state=on]:text-primary",
                  )}>
                  <BellRing className="size-3.5" />{t("rooms.RoomView.text_4c4ca82910")}</Toggle>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {replyTo
                ? t("rooms.RoomView.text_aeddd7c649")
                : ask ? t("rooms.RoomView.text_5c81fb6c44") : t("rooms.RoomView.text_6555bb6b5c")}
            </TooltipContent>
          </Tooltip>
          <span className="ml-auto hidden items-center gap-1 text-[11px] text-muted-foreground/70 min-[1200px]:group-focus-within/composer:flex">
            {attachments.items.length ? t("rooms.composer.attachmentCount", { count: attachments.items.length, limit: MAX_ATTACHMENTS }) : null}
            <Kbd>Enter</Kbd>{t("rooms.RoomView.text_edecf0ae6e")} · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>{t("rooms.RoomView.text_bd609a8e2d")}</span>
          <Button aria-label={t("rooms.RoomView.text_edecf0ae6e")} className="ml-auto min-[1200px]:group-focus-within/composer:ml-0" disabled={!canSend} onClick={() => void send()} size="icon-sm">
            {busy ? <Spinner /> : <SendHorizontal />}
          </Button>
        </div>
      </div>
      {attachments.error ? (
        <p className="mt-1.5 flex items-center gap-1.5 px-1 text-xs text-destructive" role="alert">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="flex-1">{attachments.error}</span>
          <Button aria-label={t("rooms.RoomView.text_e852b4678c")} onClick={attachments.clearError} size="icon-xs" variant="ghost"><X /></Button>
        </p>
      ) : null}
      {dragging ? (
        <div aria-hidden="true"
          className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/60 bg-background/85 backdrop-blur-sm">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary"><Paperclip className="size-6" /></span>
          <span className="font-medium">{t("rooms.RoomView.text_95e74308ee")}</span>
          <span className="text-xs text-muted-foreground">{t("rooms.RoomView.text_37fe9c7318", { limit: MAX_ATTACHMENTS })}</span>
        </div>
      ) : null}
    </div>
  );
}

// ---- 右栏：任务板 ----

function TaskBoard({ room, rooms, tabs, onOpenSession }: { room: Room; rooms: RoomsState; tabs: WorkspaceTab[]; onOpenSession?: (tabId: string) => void }) {
  useTranslation();
  const [adding, setAdding] = useState(false);
  const columns = taskColumns(room);
  const archived = room.tasks.filter((task) => task.status === "archived").length;
  const live = room.tasks.length - archived;
  const foreman = foremanOf(room);
  const busyMembers = activeMembers(room).filter((member) => memberStatus(tabs.find((tab) => tab.id === member.tabId)) === "busy").length;
  useEffect(() => setAdding(false), [room.id]);
  return (
    <aside aria-label={t("rooms.RoomView.text_0f45344baf")} className="room-taskboard flex min-h-0 flex-col border-l border-border bg-(--panel)">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <ListTodo className="size-4 text-muted-foreground" />
        <span className="font-semibold">{t("rooms.RoomView.text_0f45344baf")}</span>
        <span className="text-xs text-muted-foreground">{live}</span>
        <Button className="ml-auto" onClick={() => setAdding((value) => !value)} size="xs" variant={adding ? "secondary" : "outline"}>
          <Plus />{t("rooms.RoomView.text_6bee237280")}</Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {adding ? <TaskForm onDone={() => setAdding(false)} room={room} rooms={rooms} /> : null}
        {room.tasks.length === 0 && !adding ? (
          <Empty className="flex-none border border-dashed border-border py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon"><ListTodo /></EmptyMedia>
              <EmptyTitle className="text-sm">{busyMembers ? t("rooms.RoomView.text_4c29d76aef") : t("rooms.RoomView.text_c77ac2e81d")}</EmptyTitle>
              <EmptyDescription className="text-xs">
                {busyMembers ? t("rooms.RoomView.text_369acd5b1b", { count: busyMembers })
                  : t("rooms.RoomView.text_4718f8baf0")}
              </EmptyDescription>
            </EmptyHeader>
            {foreman && onOpenSession ? (
              <EmptyContent><Button onClick={() => onOpenSession(foreman.tabId)} size="xs" variant="outline"><SquareTerminal />{t("rooms.RoomView.text_32160c3d9a")}</Button></EmptyContent>
            ) : null}
          </Empty>
        ) : null}
        {(["active", "planned", "done"] as const).map((status) => columns[status].length ? (
          <section className="flex flex-col gap-1.5" key={status}>
            <h3 className="flex items-center gap-2 px-0.5 text-xs font-semibold text-muted-foreground">
              <TaskStatusIcon status={status} />
              {STATUS_LABEL[status]}
              <span className="font-normal opacity-70">{columns[status].length}</span>
            </h3>
            {columns[status].map((task) => <TaskCard key={task.id} room={room} rooms={rooms} task={task} />)}
          </section>
        ) : null)}
        {archived ? <p className="px-0.5 text-xs text-muted-foreground"><Archive className="mr-1 inline size-3" />{t("rooms.RoomView.text_8670481957", { count: archived })}</p> : null}
      </div>
    </aside>
  );
}

function TaskCard({ room, rooms, task }: { room: Room; rooms: RoomsState; task: RoomTask }) {
  useTranslation();
  const [open, setOpen] = useState(false);
  const blockers = openBlockers(room, task);
  const run = (op: Parameters<typeof api.roomTask>[1]) => void rooms.run(() => api.roomTask(room.id, op));
  const assignee = task.assignee ? room.members.find((member) => member.id === task.assignee) : undefined;
  return (
    <article className={cn(
      "overflow-hidden rounded-lg border border-border bg-card shadow-xs transition-shadow hover:shadow-sm",
      task.status === "done" && "opacity-75",
      open && "ring-1 ring-ring/30",
    )}>
      <button aria-expanded={open} className="flex w-full flex-col gap-1.5 px-3 py-2.5 text-left outline-none focus-visible:bg-accent/50"
        onClick={() => setOpen((value) => !value)} type="button">
        <span className="flex items-start gap-2">
          <TaskStatusIcon status={task.status} />
          <span className="mt-px font-mono text-[11px] text-muted-foreground">{task.id}</span>
          <span className={cn("min-w-0 flex-1 leading-snug font-medium", task.status === "done" && "line-through decoration-muted-foreground/50")}>
            {task.title}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {assignee ? <><MemberAvatar id={assignee.id} room={room} size="sm" /><span className="truncate">{assignee.title}</span></>
            : <span className="italic">{t("rooms.RoomView.text_59b6aaf112")}</span>}
          {blockers.length ? <Badge className="ml-auto h-5 border-warning/50 px-1.5 text-[11px] text-warning" variant="outline">{t("rooms.RoomView.text_c61526db52", { names: formatList(blockers) })}</Badge> : null}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2.5 border-t border-border bg-background/40 px-3 py-2.5 text-xs">
          {task.outcome ? <Detail label={t("rooms.RoomView.text_fa4aa984fe")}>{task.outcome}</Detail> : null}
          {task.result ? <Detail label={t("rooms.RoomView.text_bb7ef73495")}>{task.result}</Detail> : null}
          {task.notes ? (
            <Detail label={t("rooms.RoomView.text_92d5adc36c")}>
              <pre className="max-h-32 overflow-auto rounded-md bg-muted px-2 py-1.5 font-sans whitespace-pre-wrap">{task.notes}</pre>
            </Detail>
          ) : null}
          {task.status !== "done" && task.status !== "archived" ? (
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-muted-foreground">{t("rooms.RoomView.text_a525346277")}</span>
              <Select onValueChange={(value) => run({ op: "assign", task: task.id, assignee: value })} value={assignee?.title ?? ""}>
                <SelectTrigger aria-label={t("rooms.RoomView.text_a525346277")} className="h-7 flex-1 text-xs" size="sm"><SelectValue placeholder={t("rooms.RoomView.text_59b6aaf112")} /></SelectTrigger>
                <SelectContent>
                  {activeMembers(room).map((member) => <SelectItem key={member.id} value={member.title}>{member.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <p className="text-muted-foreground/80">{t("rooms.RoomView.text_48588d6ca1", { name: labelOf(room, task.createdBy), time: formatTime(task.createdAt) })}</p>
          <div className="flex flex-wrap gap-1.5">
            {task.status === "planned" ? (
              <Button disabled={blockers.length > 0} onClick={() => run({ op: "start", task: task.id })} size="xs" variant="outline"><Play />{t("rooms.RoomView.text_2849891504")}</Button>
            ) : null}
            {task.status === "planned" || task.status === "active" ? (
              <Button onClick={() => run({ op: "done", task: task.id })} size="xs"><Check />{t("rooms.RoomView.text_c0b3fbff51")}</Button>
            ) : null}
            {task.status === "active" || task.status === "done" ? (
              <Button onClick={() => run({ op: "reopen", task: task.id })} size="xs" variant="outline"><RotateCcw />{t("rooms.RoomView.text_e608dd8385")}</Button>
            ) : null}
            <Button className="ml-auto text-muted-foreground" onClick={() => run({ op: "archive", task: task.id })} size="xs" variant="ghost">
              <Archive />{t("rooms.RoomView.text_5292ab1a36")}</Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function TaskStatusIcon({ status }: { status: TaskStatus }) {
  useTranslation();
  const icon = {
    planned: <CircleDashed className="size-4 text-muted-foreground" />,
    active: <CircleDot className="size-4 text-primary" />,
    done: <CircleCheck className="size-4 text-success" />,
    archived: <Archive className="size-4 text-muted-foreground" />,
  }[status];
  return <span aria-label={STATUS_LABEL[status]} className="mt-px shrink-0" role="img" title={STATUS_LABEL[status]}>{icon}</span>;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  useTranslation();
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 leading-relaxed whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function TaskForm({ room, rooms, onDone }: { room: Room; rooms: RoomsState; onDone: () => void }) {
  useTranslation();
  const [title, setTitle] = useState("");
  const [outcome, setOutcome] = useState("");
  const [assignee, setAssignee] = useState("");
  const [after, setAfter] = useState<string[]>([]);
  const open = room.tasks.filter((task) => task.status === "planned" || task.status === "active");
  const submit = async () => {
    if (!title.trim()) return;
    const created = await rooms.run(() => api.roomTask(room.id, { op: "add", title, outcome: outcome || null, assignee: assignee || null, after }));
    if (created) onDone();
  };
  return (
    <form className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 shadow-sm"
      onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <Input aria-label={t("rooms.RoomView.text_f118de64d6")} autoFocus maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder={t("rooms.RoomView.text_f118de64d6")} value={title} />
      <Textarea aria-label={t("rooms.RoomView.text_fa4aa984fe")} className="min-h-14 text-sm" onChange={(event) => setOutcome(event.target.value)}
        placeholder={t("rooms.RoomView.text_df3d1cf7e4")} rows={2} value={outcome} />
      <Select onValueChange={setAssignee} value={assignee}>
        <SelectTrigger aria-label={t("rooms.RoomView.text_a525346277")} className="w-full" size="sm"><SelectValue placeholder={t("rooms.RoomView.text_205cf96a14")} /></SelectTrigger>
        <SelectContent>
          {activeMembers(room).map((member) => <SelectItem key={member.id} value={member.title}>{member.title}</SelectItem>)}
        </SelectContent>
      </Select>
      {open.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t("rooms.RoomView.text_abc76e272d")}</span>
          {open.map((task) => (
            <Label className="flex cursor-pointer items-center gap-2 text-xs font-normal" key={task.id}>
              <Checkbox checked={after.includes(task.id)}
                onCheckedChange={(checked) => setAfter((list) => checked === true ? [...list, task.id] : list.filter((id) => id !== task.id))} />
              <span className="font-mono text-muted-foreground">{task.id}</span> {excerpt(task.title, 18)}
            </Label>
          ))}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone} size="sm" type="button" variant="ghost">{t("rooms.RoomView.text_2cd0f3be87")}</Button>
        <Button disabled={!title.trim() || rooms.busy} size="sm" type="submit">{t("rooms.RoomView.text_5a4058d383")}</Button>
      </div>
    </form>
  );
}

// ---- 对话框 ----

function agentOptions(agents: AgentAvailability[]) {
  return agents
    .filter((agent) => agent.available && isAgentKind(agent.kind))
    .map((agent) => ({ value: agent.kind, label: agent.descriptor.displayName }));
}

/** 拉起一位成员：开会话、进房间、起协作名。返回失败理由或 null。 */
async function launchInto(
  room: Room, row: RosterRow & { kind: AgentKind }, foreman: boolean,
  launch: NonNullable<RoomViewProps["onLaunchMember"]>, rename: RoomViewProps["onRenameAgent"],
): Promise<string | null> {
  const tabId = await launch(row.kind, room.projectRoot);
  if (!tabId) return t("rooms.RoomView.text_2a2cb6b3f9", { title: row.title });
  try {
    await api.roomAddMember(room.id, tabId, row.kind, row.title, row.duty, foreman);
  } catch (cause) {
    return cause instanceof Error ? cause.message : String((cause as { message?: string })?.message ?? cause);
  }
  rename?.(tabId, row.title);
  return null;
}

/** 忙的时候不让关：成员正在一个个拉起，半路关掉会留下没进房间的会话。 */
function guardedClose(busy: boolean, onClose: () => void) {
  return {
    onOpenChange: (open: boolean) => { if (!open && !busy) onClose(); },
    onEscapeKeyDown: (event: KeyboardEvent) => { if (busy) event.preventDefault(); },
    onInteractOutside: (event: Event) => { if (busy) event.preventDefault(); },
  };
}

function NewRoomDialog(props: {
  agents: AgentAvailability[]; project: ProjectWorkspace | null; rooms: RoomsState; onClose: () => void;
  onLaunchMember?: RoomViewProps["onLaunchMember"]; onRenameAgent?: RoomViewProps["onRenameAgent"];
}) {
  useTranslation();
  const id = useId();
  const kinds = agentOptions(props.agents);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [roster, setRoster] = useState<(RosterRow & { kind: AgentKind })[]>(
    () => DEFAULT_ROSTER.map((row) => ({ ...row, kind: (kinds[0]?.value ?? "claude") as AgentKind })),
  );
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const selection = useRoomProject(props.project);
  const locked = busy || selection.busy;
  const [error, setError] = useFeedback<string | null>(null);
  const canLaunch = Boolean(props.onLaunchMember) && kinds.length > 0;
  const rowErrors = roster.map((row, index) => titleError(row.title, roster.filter((_, other) => other !== index).map((r) => r.title)));
  const update = (index: number, patch: Partial<RosterRow & { kind: AgentKind }>) =>
    setRoster((rows) => rows.map((row, at) => at === index ? { ...row, ...patch } : row));
  const submit = async () => {
    if (!name.trim() || locked || submitting.current || !selection.canSubmit || !selection.project || (canLaunch && rowErrors.some(Boolean))) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const room = await props.rooms.create(name, selection.project.rootPath, objective);
      if (room && canLaunch && props.onLaunchMember) {
        // 逐个拉起；任何一步失败就停，已经建好的房间和成员都保留——半路回滚会丢掉已经起好的会话。
        for (const [index, row] of roster.entries()) {
          const reason = await launchInto(room, row, index === 0, props.onLaunchMember, props.onRenameAgent);
          if (reason) { setError(() => t("rooms.RoomView.text_90d75dd820", { reason: reason })); void props.rooms.refresh(); return; }
        }
        void props.rooms.refresh();
      }
      if (room) props.onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const { onOpenChange, ...guards } = guardedClose(locked, props.onClose);
  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-4 sm:max-w-2xl" {...guards}>
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("rooms.RoomView.text_b88f06080b")}</DialogTitle>
          <DialogDescription>{t("rooms.RoomView.text_7e8a9fdb2f")}</DialogDescription>
        </DialogHeader>
        <div data-room-create-fields className="min-h-0 overflow-y-auto">
        <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={locked}>
          <Field id={`${id}-name`} label={t("rooms.RoomView.text_9d9f6a08cf")}>
            <Input autoFocus id={`${id}-name`} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder={t("rooms.RoomView.text_db93bd3ad1")} value={name} />
          </Field>
          <div data-room-project>
            <Field id={`${id}-project`} label={t("rooms.new.projectLabel")}>
              {selection.project ? <span className="truncate text-sm font-medium">{selection.project.name}</span> : null}
              <div className="flex min-w-0 items-center gap-2">
                <Input id={`${id}-project`} className="min-w-0 flex-1" readOnly value={selection.path}
                  aria-required="true" aria-invalid={Boolean(selection.error)}
                  aria-describedby={`${id}-project-hint${selection.error ? ` ${id}-project-error` : ""}`}
                  placeholder={t("rooms.new.projectRequired")} title={selection.path} />
                <Button className="shrink-0" disabled={locked} onClick={() => void selection.choose()} variant="outline"
                  aria-label={t("rooms.new.selectProject")}>
                  {selection.busy ? <Spinner /> : <FolderGit2 />}{t("rooms.new.choose")}
                </Button>
              </div>
              <p id={`${id}-project-hint`} className="text-xs text-muted-foreground" role={selection.busy ? "status" : undefined}>
                {selection.busy ? t("rooms.new.projectChecking") : t("rooms.new.projectHint")}
              </p>
              {selection.error ? <p id={`${id}-project-error`} className="break-words text-xs text-destructive" role="alert">
                {t("rooms.new.projectError", { reason: selection.error })}
              </p> : null}
            </Field>
          </div>
          <Field id={`${id}-objective`} label={t("rooms.RoomView.text_7011272724")}>
            <Textarea className="min-h-20" id={`${id}-objective`} onChange={(event) => setObjective(event.target.value)} placeholder={t("rooms.RoomView.text_bce659ddb4")} rows={3} value={objective} />
          </Field>
          {canLaunch ? (
            <Field label={selection.project ? t("rooms.RoomView.text_fd3e5af2bf", { name: selection.project.name }) : t("rooms.new.teamWithoutProject")}>
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="grid grid-cols-[104px_minmax(0,1fr)_minmax(0,1fr)_112px_28px] gap-2 border-b border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  <span>{t("rooms.RoomView.text_2a9c9e9976")}</span><span>{t("rooms.RoomView.text_c0362bdb59")}</span><span>{t("rooms.RoomView.text_6d513de90d")}</span><span>Agent</span><span />
                </div>
                {roster.map((row, index) => (
                  <div className="grid grid-cols-[104px_minmax(0,1fr)_minmax(0,1fr)_112px_28px] items-center gap-2 border-b border-border px-3 py-2 last:border-b-0" key={index}>
                    {index === 0 ? (
                      <Badge className="border-warning/50 text-warning" variant="outline"><Crown />{t("rooms.RoomView.text_8153348240")}</Badge>
                    ) : <Badge variant="secondary">{t("rooms.RoomView.text_6e6d6ddbb7")}</Badge>}
                    <Input aria-invalid={Boolean(rowErrors[index])} aria-label={t("rooms.RoomView.text_c0362bdb59")} className="h-8"
                      onChange={(event) => update(index, { title: event.target.value })} title={rowErrors[index] ?? undefined} value={row.title} />
                    <Input aria-label={t("rooms.RoomView.text_6d513de90d")} className="h-8" onChange={(event) => update(index, { duty: event.target.value })} placeholder={t("rooms.RoomView.text_6d513de90d")} value={row.duty} />
                    <Select onValueChange={(kind) => update(index, { kind: kind as AgentKind })} value={row.kind}>
                      <SelectTrigger aria-label="Agent" className="w-full" size="sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {kinds.map((kind) => <SelectItem key={kind.value} value={kind.value}>{kind.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button aria-label={t("rooms.RoomView.text_a3a6479e4e")} disabled={roster.length === 1} size="icon-sm" variant="ghost"
                      onClick={() => setRoster((rows) => rows.filter((_, at) => at !== index))}>
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
              <Button className="self-start" onClick={() => setRoster((rows) => [...rows, { title: "", duty: "", kind: rows[0]?.kind ?? "claude" }])}
                size="xs" variant="ghost">
                <Plus />{t("rooms.RoomView.text_5877032e03")}</Button>
              {rowErrors.find(Boolean) ? <p className="text-xs text-destructive">{rowErrors.find(Boolean)}</p> : null}
            </Field>
          ) : (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">{t("rooms.RoomView.text_e945c2de3b")}</p>
          )}
          {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        </fieldset>
        </div>
        <DialogFooter className="shrink-0">
          <Button disabled={locked} onClick={props.onClose} variant="outline">{t("rooms.RoomView.text_2cd0f3be87")}</Button>
          <Button data-room-create disabled={locked || !selection.canSubmit || !name.trim() || (canLaunch && rowErrors.some(Boolean))} onClick={() => void submit()}>
            {busy ? <><Spinner />{t("rooms.RoomView.text_c83943535e")}</> : t("rooms.RoomView.text_cde2cd071d")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMemberDialog(props: {
  agents: AgentAvailability[]; room: Room; rooms: RoomsState; tabs: WorkspaceTab[]; onClose: () => void;
  onLaunchMember?: RoomViewProps["onLaunchMember"]; onRenameAgent?: RoomViewProps["onRenameAgent"];
}) {
  useTranslation();
  const { room } = props;
  const id = useId();
  const kinds = agentOptions(props.agents);
  const taken = new Set(props.rooms.rooms.flatMap((summary) => summary.memberTabIds));
  const existing = props.tabs.filter((tab) => isAgentKind(tab.kind) && tab.phase === "running" && !taken.has(tab.id));
  const sources = [
    ...(props.onLaunchMember ? kinds.map((kind) => ({ value: `new:${kind.value}`, label: t("rooms.RoomView.text_229e837eff", { label: kind.label }) })) : []),
    ...existing.map((tab) => ({ value: `tab:${tab.id}`, label: t("rooms.RoomView.text_e2b9d40302", { name: tab.agentName ?? tab.title }) })),
  ];
  const [source, setSource] = useState(sources[0]?.value ?? "");
  const [title, setTitle] = useState("");
  const [duty, setDuty] = useState("");
  const [foreman, setForeman] = useState(foremanOf(room) === null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedback<string | null>(null);
  const invalid = titleError(title, activeMembers(room).map((member) => member.title));
  const current = foremanOf(room);
  const submit = async () => {
    if (invalid || !source || busy) return;
    setBusy(true);
    setError(null);
    let reason: string | null = null;
    if (source.startsWith("new:") && props.onLaunchMember) {
      reason = await launchInto(room, { title, duty, kind: source.slice(4) as AgentKind }, foreman, props.onLaunchMember, props.onRenameAgent);
    } else {
      const tab = existing.find((candidate) => `tab:${candidate.id}` === source);
      const added = tab ? await props.rooms.run(() => api.roomAddMember(room.id, tab.id, tab.kind, title, duty, foreman)) : null;
      if (added && tab) props.onRenameAgent?.(tab.id, title);
      if (!added) reason = t("rooms.RoomView.text_3853761b1d");
    }
    setBusy(false);
    void props.rooms.refresh();
    if (reason) setError(reason);
    else props.onClose();
  };
  const { onOpenChange, ...guards } = guardedClose(busy, props.onClose);
  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent className="gap-5" {...guards}>
        <DialogHeader>
          <DialogTitle>{t("rooms.RoomView.text_ad9737dafd")}</DialogTitle>
          <DialogDescription>{t("rooms.RoomView.text_c803011fb4")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field id={`${id}-source`} label={t("rooms.RoomView.text_a63280253f")}>
            <Select disabled={!sources.length} onValueChange={setSource} value={source}>
              <SelectTrigger className="w-full" id={`${id}-source`}><SelectValue placeholder={t("rooms.RoomView.text_2a5155a67f")} /></SelectTrigger>
              <SelectContent>
                {sources.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field id={`${id}-title`} label={t("rooms.RoomView.text_c0362bdb59")}>
            <Input aria-invalid={Boolean(title) && Boolean(invalid)} autoFocus id={`${id}-title`} maxLength={24}
              onChange={(event) => setTitle(event.target.value)} placeholder={t("rooms.RoomView.text_aaaea128a6")} value={title} />
            {title && invalid ? <p className="text-xs text-destructive">{invalid}</p> : null}
          </Field>
          <Field id={`${id}-duty`} label={t("rooms.RoomView.text_6d513de90d")}>
            <Input id={`${id}-duty`} onChange={(event) => setDuty(event.target.value)} placeholder={t("rooms.RoomView.text_8995d480c7")} value={duty} />
          </Field>
          <Label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 font-normal">
            <Checkbox checked={foreman} className="mt-0.5" onCheckedChange={(checked) => setForeman(checked === true)} />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t("rooms.RoomView.text_2bff5da681")}</span>
              <span className="text-xs text-muted-foreground">
                {current ? t("rooms.RoomView.text_52f3ea95df", { title: current.title }) : t("rooms.RoomView.text_b841e821cc")}
              </span>
            </span>
          </Label>
          {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={props.onClose} variant="outline">{t("rooms.RoomView.text_2cd0f3be87")}</Button>
          <Button disabled={busy || Boolean(invalid) || !source} onClick={() => void submit()}>
            {busy ? <><Spinner />{t("rooms.RoomView.text_cc708a7a29")}</> : t("rooms.RoomView.text_7a8a11ead5")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
