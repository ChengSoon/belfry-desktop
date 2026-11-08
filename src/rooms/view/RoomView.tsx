import {
  AlertTriangle, Archive, BellRing, Check, CheckCheck, CircleCheck, CircleDashed, CircleDot, Clock, Crown, FolderGit2,
  Inbox, Info, ListTodo, MessageSquareReply, MessagesSquare, MoreHorizontal, Network, Paperclip, Pause, Pencil, Play, Plus, RotateCcw, Search, ArrowDown, Eraser,
  SendHorizontal, SquareTerminal, Trash2, UserMinus, UserPlus, Users, X,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { createContext, Fragment, useContext, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
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
import type { TerminalChoice } from "../../terminal/choice";
import type { TerminalCommandTarget } from "../../terminal/contracts";
import { pointInsideRect } from "../../terminal/fileDrop";
import { composingKey } from "../../utils/keyboard";
import { toAppFailure } from "../../workspace/errors";
import type { ProjectWorkspace, WorkspaceTab } from "../../workspace/contracts";
import * as api from "../api";
import { clipboardRoomFiles } from "../attachmentApi";
import { MAX_ATTACHMENTS, messageSummary, transferFiles } from "../attachments";
import { firstUnread, isUnread, latestToUser, markSeen, readSeen, useSeenVersion } from "../inbox";
import type { Room, RoomMember, RoomMessage, RoomTask, TaskStatus } from "../contracts";
import {
  activeMembers, awaitingReply, continues, dayKey, dayLabel, DEFAULT_ROSTER, excerpt, foremanOf,
  formatTime, hueOf, initialOf, labelOf, MEMBER_STATUS_TEXT as STATUS_TEXT, memberStatus, type MemberStatus, openBlockers, progress, recipientOptions, shortId, STATUS_LABEL, taskColumns,
  titleError, workload, type RosterRow, applyMention, mentionOptions, mentionQuery, type MentionOption,
} from "../model";
import { useRoomAttachments } from "../useRoomAttachments";
import { useRooms, type RoomsState } from "../useRooms";
import { AttachmentCard, MessageAttachments } from "./RoomAttachments";
import { RoomFlow } from "./RoomFlow";
import { RoomMarkdown } from "./RoomMarkdown";
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
  | { kind: "remove-member"; member: RoomMember };

/** 开着的 Radix 浮层：下拉菜单、选择框、提示（popper）与对话框。 */
const OPEN_LAYER = "[data-radix-popper-content-wrapper], [data-slot=dialog-content], [data-slot=alert-dialog-content]";

/** Radix Select 不接受空字符串当选项值；「按默认收件人」用这个占位。 */
const AUTO_RECIPIENT = "__auto";

export function RoomView(props: RoomViewProps) {
  const rooms = useRooms();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const room = rooms.room;

  // Escape 关整个视图。Radix 的下拉菜单、选择框、提示在 document 捕获阶段处理 Escape，但不 preventDefault；
  // 它们收起时 DOM 还没更新，所以按「此刻有没有浮层开着」判断：开着就只让浮层收起。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || composingKey(event) || dialog) return;
      if (document.querySelector(OPEN_LAYER)) return;
      props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, props.onClose]);

  const [search, setSearch] = useState("");
  useSeenVersion();
  const ordered = useMemo(
    () => [...rooms.rooms].sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)),
    [rooms.rooms],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? ordered.filter((summary) => `${summary.name} ${summary.objective}`.toLowerCase().includes(q)) : ordered;
  }, [ordered, search]);
  const actions = useMemo(() => ({ onOpenFile: props.onOpenFile, onClearContext: props.onClearContext }), [props.onOpenFile, props.onClearContext]);
  const close = () => setDialog(null);
  const canCreate = props.project !== null && rooms.loadError === null;

  return (
    <RoomActions.Provider value={actions}>
    <TooltipProvider delayDuration={300}>
      <section aria-label="协作房间"
        className="room-view grid min-h-0 min-w-0 grid-cols-[256px_minmax(0,1fr)_320px] bg-background text-foreground text-sm max-[1080px]:grid-cols-[232px_minmax(0,1fr)_280px]">
        <aside className="flex min-h-0 flex-col border-r border-border bg-(--sidebar)">
          <header className="flex h-12 shrink-0 items-center gap-1 px-3">
            <span className="flex-1 text-[15px] font-semibold tracking-tight">协作房间</span>
            <IconButton disabled={!canCreate} label={props.project ? "新建房间" : "先在左侧打开一个项目，房间归属项目"}
              onClick={() => setDialog({ kind: "new-room" })}>
              <Plus />
            </IconButton>
            <IconButton label="关闭房间（Esc）" onClick={props.onClose}><X /></IconButton>
          </header>
          {rooms.loadError ? (
            <p className="mx-3 mb-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning" role="alert">
              {rooms.loadError}
            </p>
          ) : null}
          {ordered.length > 3 ? (
            <div className="relative mx-2 mb-1.5">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="搜索房间" className="h-7 pl-7 text-xs" onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape" && search) { event.preventDefault(); setSearch(""); } }}
                placeholder="搜索房间" value={search} />
            </div>
          ) : null}
          <nav aria-label="房间列表" className="flex shrink-0 flex-col gap-0.5 overflow-y-auto px-2 pb-2 max-h-[40%]">
            {shown.map((summary) => {
              const active = summary.id === rooms.selectedId;
              const total = summary.doneTasks + summary.openTasks;
              const unread = !active && isUnread(summary);
              return (
                <button aria-current={active} key={summary.id} onClick={() => rooms.select(summary.id)}
                  title={summary.projectRoot} type="button"
                  className={cn(
                    "group flex flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors outline-none",
                    "hover:bg-(--sidebar-hover) focus-visible:ring-2 focus-visible:ring-ring/50",
                    active && "bg-(--sidebar-active) shadow-(--sidebar-active-shadow)",
                  )}>
                  <span className="flex items-center gap-1.5">
                    <span className={cn("truncate font-medium", unread && "font-semibold")}>{summary.name}</span>
                    {summary.paused ? <Pause aria-label="已暂停" className="size-3 shrink-0 text-warning" /> : null}
                    {unread ? (
                      <span className="ml-auto size-2 shrink-0 rounded-full bg-primary" title={`${summary.lastToUser?.from}：${summary.lastToUser?.text}`}>
                        <span className="sr-only">有发给你的新消息</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Users className="size-3" /> {summary.memberCount}
                    <ListTodo className="ml-1 size-3" /> {summary.doneTasks}/{total}
                    {total ? <Progress className="ml-auto h-1 w-12" value={(summary.doneTasks / total) * 100} /> : null}
                  </span>
                </button>
              );
            })}
            {ordered.length > 0 && shown.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">没有匹配「{search}」的房间。</p>
            ) : null}
            {ordered.length === 0 ? (
              <p className="px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                还没有房间。一间房里一位统筹拆需求、派活、跟进度，其他成员各管自己的职责，一起把一个需求做完。
              </p>
            ) : null}
          </nav>
          {room ? (
            <MemberList onAdd={() => setDialog({ kind: "add-member" })} onOpenSession={props.onOpenSession}
              onRemove={(member) => setDialog({ kind: "remove-member", member })} room={room} rooms={rooms} tabs={props.tabs} />
          ) : null}
        </aside>

        {room ? (
          <>
            <main className="relative flex min-h-0 min-w-0 flex-col">
              <RoomHeader onDelete={() => setDialog({ kind: "delete-room", room })} room={room} rooms={rooms} />
              {room.paused ? (
                <div className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-xs" role="status">
                  <Pause className="size-3.5 shrink-0 text-warning" />
                  <span className="flex-1">房间已暂停：消息只记在这里，不送进成员终端，空闲提醒也停了。成员手上正在做的不会被打断。</span>
                  <Button onClick={() => void rooms.run(() => api.roomSetPaused(room.id, false))} size="xs" variant="outline"><Play /> 恢复</Button>
                </div>
              ) : null}
              <AttentionPanel onOpenSession={props.onOpenSession} onResume={props.onResumeDelivery}
                paused={props.pausedDeliveries ?? []} room={room} tabs={props.tabs} targets={props.targets} />
              <BriefPanel room={room} rooms={rooms} />
              <CenterTabs onOpenSession={props.onOpenSession} room={room} rooms={rooms} tabs={props.tabs} />
            </main>
            <TaskBoard room={room} rooms={rooms} />
          </>
        ) : (
          <main className="col-span-2 flex min-h-0 items-center justify-center">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><MessagesSquare /></EmptyMedia>
                <EmptyTitle>{ordered.length ? "选一间房" : "还没有协作房间"}</EmptyTitle>
                <EmptyDescription>
                  {ordered.length
                    ? "从左侧选一间房，看对话、任务板和成员。"
                    : "一间房对应一个需求：写下要做成什么，拉几个 Agent 进来，统筹会把它拆成任务派给成员。"}
                </EmptyDescription>
              </EmptyHeader>
              {!ordered.length ? (
                <EmptyContent>
                  <Button disabled={!canCreate} onClick={() => setDialog({ kind: "new-room" })}><Plus /> 新建房间</Button>
                  {!props.project ? <span className="text-xs text-muted-foreground">先在左侧打开一个项目，房间归属项目。</span> : null}
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
            <Button aria-label="关闭提示" className="-my-1 -mr-1" onClick={rooms.dismissError} size="icon-xs" variant="ghost"><X /></Button>
          </div>
        ) : null}

        {dialog?.kind === "new-room" && props.project ? (
          <NewRoomDialog agents={props.agents} onClose={close} onLaunchMember={props.onLaunchMember}
            onRenameAgent={props.onRenameAgent} project={props.project} rooms={rooms} />
        ) : null}
        {dialog?.kind === "add-member" && room ? (
          <AddMemberDialog agents={props.agents} onClose={close} onLaunchMember={props.onLaunchMember}
            onRenameAgent={props.onRenameAgent} room={room} rooms={rooms} tabs={props.tabs} />
        ) : null}
        {dialog?.kind === "delete-room" ? (
          <ConfirmDialog body="房间、任务板和聊天记录都会删掉，找不回来。成员的会话不受影响。"
            confirmLabel="删除房间" onCancel={close} open title={`删除「${dialog.room.name}」？`}
            onConfirm={() => { void rooms.remove(dialog.room.id); close(); }} />
        ) : null}
        {dialog?.kind === "remove-member" && room ? (
          <ConfirmDialog body="会话不会关掉；他手上没做完的任务会交还统筹重新分派。"
            confirmLabel="移出" onCancel={close} open title={`把「${dialog.member.title}」移出房间？`}
            onConfirm={() => { void rooms.run(() => api.roomRemoveMember(room.id, dialog.member.id)); close(); }} />
        ) : null}
      </section>
    </TooltipProvider>
    </RoomActions.Provider>
  );
}

/** 用户发给成员的消息的送达情况。只记送达，读没读我们看不到。 */
function deliveryState(room: Room, message: RoomMessage): { label: string; title: string; pending: boolean } | null {
  const members = message.to.filter((id) => id !== "user");
  if (message.kind !== "chat" || message.by !== "user" || members.length === 0) return null;
  const pending = members.filter((id) => !message.deliveredTo.includes(id));
  const names = (ids: string[]) => ids.map((id) => labelOf(room, id)).join("、");
  if (pending.length === 0) return { label: "已送达", title: `已送进 ${names(members)} 的终端`, pending: false };
  return { label: `排队中 ${pending.length}/${members.length}`, title: `还没送进 ${names(pending)} 的终端`, pending: true };
}

// ---- 小部件 ----

function IconButton({ label, children, className, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
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
  const member = room.members.find((candidate) => candidate.id === id);
  const label = id === "user" ? "你" : initialOf(member?.title ?? "?");
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
  return (
    <AlertDialog onOpenChange={(open) => { if (!open) props.onCancel(); }} open={props.open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm} variant="destructive">{props.confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SectionHeader({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <header className="flex h-9 shrink-0 items-center gap-2 px-3">
      <span className="text-xs font-semibold tracking-wide text-muted-foreground">{title}</span>
      {count !== undefined ? <span className="text-xs text-muted-foreground/70">{count}</span> : null}
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
}) {
  const { room, rooms } = props;
  const members = activeMembers(room);
  const { onClearContext } = useContext(RoomActions);
  const [cleared, setCleared] = useState<string | null>(null);
  return (
    <section aria-label="成员" className="flex min-h-0 flex-1 flex-col border-t border-border">
      <SectionHeader count={members.length} title="成员">
        <IconButton label="添加成员" onClick={props.onAdd}><UserPlus /></IconButton>
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
                      <TooltipTrigger asChild><Crown aria-label="统筹" className="size-3.5 shrink-0 text-warning" /></TooltipTrigger>
                      <TooltipContent>统筹：拆需求、派活、跟进度</TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted-foreground" title={current ? `${current.id} ${current.title}` : member.duty || undefined}>
                  <span className={cn(status === "waiting" && "font-medium text-warning")}>{cleared === member.id ? "已清除上下文" : STATUS_TEXT[status]}</span>
                  {current ? <> · <span className="text-foreground/80">{current.id} {current.title}</span></> : member.duty ? <> · {member.duty}</> : null}
                </div>
              </div>
              {load ? (
                <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums" title={`手上 ${load} 件没完成`}>
                  <ListTodo className="size-3" />{load}
                </span>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-label={`${member.title} 的操作`} size="icon-xs" variant="ghost"
                    className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  {tab && props.onOpenSession ? (
                    <DropdownMenuItem onSelect={() => props.onOpenSession?.(tab.id)}><SquareTerminal /> 打开终端</DropdownMenuItem>
                  ) : null}
                  {tab && onClearContext ? (
                    <DropdownMenuItem onSelect={() => {
                      if (onClearContext(tab.id)) { setCleared(member.id); window.setTimeout(() => setCleared(null), 4000); }
                    }}>
                      <Eraser /> 清除上下文
                    </DropdownMenuItem>
                  ) : null}
                  {member.role !== "foreman" ? (
                    <DropdownMenuItem onSelect={() => void rooms.run(() => api.roomSetForeman(room.id, member.id))}>
                      <Crown /> 设为统筹
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => props.onRemove(member)} variant="destructive"><UserMinus /> 移出房间</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
        {members.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-2 py-2">
            <p className="text-xs leading-relaxed text-muted-foreground">还没有成员。第一位加入的成员自动当统筹。</p>
            <Button onClick={props.onAdd} size="sm" variant="outline"><UserPlus /> 添加成员</Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ---- 中栏：标题 ----

function RoomHeader({ room, rooms, onDelete }: { room: Room; rooms: RoomsState; onDelete: () => void }) {
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
        <Input aria-label="房间名" autoFocus className="h-8 max-w-xs text-[15px] font-semibold" maxLength={40}
          onBlur={() => void save()} onChange={(event) => setName(event.target.value)} value={name}
          onKeyDown={(event) => {
            if (composingKey(event)) return;
            if (event.key === "Enter") void save();
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setName(room.name); setEditing(false); }
          }} />
      ) : (
        <button className="group flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-[15px] font-semibold tracking-tight hover:bg-accent"
          onClick={() => setEditing(true)} title="点击改名" type="button">
          <span className="truncate">{room.name}</span>
          <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </button>
      )}
      {room.paused ? <Badge className="border-warning/50 text-warning" variant="outline"><Pause /> 已暂停</Badge> : null}
      <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" title={room.projectRoot}>
        <FolderGit2 className="size-3.5 shrink-0" />
        <span className="truncate">{room.projectRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? room.projectRoot}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground" title="已完成 / 任务总数（不含归档）">
        <Progress className="h-1.5 w-24" value={total ? (done / total) * 100 : 0} />
        <span className="tabular-nums">{done}/{total}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="房间操作" className="text-muted-foreground" size="icon-sm" variant="ghost"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil /> 改名</DropdownMenuItem>
          {room.paused ? (
            <DropdownMenuItem onSelect={() => void rooms.run(() => api.roomSetPaused(room.id, false))}><Play /> 恢复房间</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => void rooms.run(() => api.roomSetPaused(room.id, true))}><Pause /> 暂停房间</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete} variant="destructive"><Trash2 /> 删除房间</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

// ---- 中栏：需要你处理的事 ----

/** 读选择框的节奏：选择框出现后用户要能很快看到，但没必要每帧都读屏。 */
const CHOICE_POLL_MS = 700;

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
  const { room, tabs, targets } = props;
  const members = activeMembers(room);
  const waiting = members.filter((member) => memberStatus(tabs.find((tab) => tab.id === member.tabId)) === "waiting");
  const stuck = members.filter((member) => props.paused.some((item) => item.tabId === member.tabId));
  const [choices, setChoices] = useState<ReadonlyMap<string, TerminalChoice | null>>(new Map());
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map());
  const waitingKey = waiting.map((member) => member.tabId).join(",");

  useEffect(() => {
    if (!waitingKey) { setChoices(new Map()); return; }
    const read = () => setChoices((current) => {
      const next = new Map<string, TerminalChoice | null>();
      for (const tabId of waitingKey.split(",")) next.set(tabId, targets?.get(tabId)?.readChoice?.() ?? null);
      const same = next.size === current.size
        && [...next].every(([tabId, choice]) => current.get(tabId)?.signature === choice?.signature);
      return same ? current : next;
    });
    read();
    const timer = window.setInterval(read, CHOICE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waitingKey, targets]);

  if (!waiting.length && !stuck.length) return null;
  const note = (tabId: string, text: string) => setNotes((current) => new Map(current).set(tabId, text));
  const answer = (member: RoomMember, choice: TerminalChoice, index: number) => {
    const result = targets?.get(member.tabId)?.answerChoice?.(choice.signature, index) ?? "unavailable";
    if (result === "sent") note(member.tabId, `已替你选了「${choice.options[index - 1]?.label ?? index}」`);
    else if (result === "changed") note(member.tabId, "选择框刚刚变了，没有发送。看一下新的内容再选。");
    else note(member.tabId, "终端现在接不了按键，去终端里处理。");
  };

  return (
    <section aria-label="需要你处理" className="flex max-h-[40%] shrink-0 flex-col gap-2 overflow-y-auto border-b border-border bg-warning/5 px-4 py-3">
      {waiting.map((member) => {
        const choice = choices.get(member.tabId) ?? null;
        return (
          <article className="rounded-lg border border-warning/50 bg-card p-3 shadow-sm" key={member.id} role="alert">
            <header className="flex items-center gap-2">
              <MemberAvatar id={member.id} room={room} size="sm" />
              <span className="font-medium">{member.title}</span>
              <Badge className="border-warning/50 text-warning" variant="outline">在等你选择</Badge>
              {props.onOpenSession ? (
                <Button className="ml-auto" onClick={() => props.onOpenSession?.(member.tabId)} size="xs" variant="ghost">
                  <SquareTerminal /> 去终端处理
                </Button>
              ) : null}
            </header>
            {choice ? (
              <div className="mt-2.5 flex flex-col gap-2">
                <p className="font-medium leading-relaxed">{choice.question}</p>
                {choice.detail ? (
                  <pre className="overflow-x-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                    {choice.detail}
                  </pre>
                ) : null}
                <div className="flex flex-col gap-1.5">
                  {choice.options.map((option) => (
                    <Button className="h-auto justify-start py-2 text-left whitespace-normal" key={option.index}
                      onClick={() => answer(member, choice, option.index)}
                      variant={option.index === choice.selected ? "secondary" : "outline"}>
                      <Kbd>{option.index}</Kbd>
                      <span className="flex-1">{option.label}</span>
                      {option.index === choice.selected ? <span className="text-xs text-muted-foreground">光标在这里</span> : null}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                没读出选项（可能要你打字回答，或界面是我们不认得的样子），去终端里处理。
              </p>
            )}
            {notes.get(member.tabId) ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs"><Info className="size-3.5 text-muted-foreground" />{notes.get(member.tabId)}</p>
            ) : null}
          </article>
        );
      })}
      {stuck.map((member) => (
        <article className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 shadow-sm" key={`stuck-${member.id}`}>
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">发给「{member.title}」的消息暂停了</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ml-2 cursor-help text-xs text-muted-foreground underline decoration-dotted underline-offset-2">为什么？</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                没能确认上一条消息被提交，后面的消息先不送，免得重复粘贴。已经提交了就点「继续投递」；还卡在输入区就去终端按一下回车。
              </TooltipContent>
            </Tooltip>
          </span>
          {props.onOpenSession ? (
            <Button onClick={() => props.onOpenSession?.(member.tabId)} size="xs" variant="ghost"><SquareTerminal /> 去终端</Button>
          ) : null}
          <Button onClick={() => props.onResume?.(member.tabId)} size="xs"><Play /> 继续投递</Button>
        </article>
      ))}
    </section>
  );
}

// ---- 中栏：需求简报 ----

function BriefPanel({ room, rooms }: { room: Room; rooms: RoomsState }) {
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
    <section aria-label="需求简报" className="shrink-0 border-b border-border px-4 py-2.5">
      {editing ? (
        <div className="flex flex-col gap-3">
          <Field id={`${id}-objective`} label="需求目标">
            <Textarea autoFocus className="min-h-16" id={`${id}-objective`} onChange={(event) => setObjective(event.target.value)} rows={3} value={objective} />
          </Field>
          <Field id={`${id}-focus`} label="当前重点">
            <Input id={`${id}-focus`} onChange={(event) => setFocus(event.target.value)} value={focus} />
          </Field>
          <Field hint="一行一条" id={`${id}-constraints`} label="约束">
            <Textarea className="min-h-12" id={`${id}-constraints`} onChange={(event) => setConstraints(event.target.value)} rows={2} value={constraints} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(false)} size="sm" variant="ghost">取消</Button>
            <Button disabled={rooms.busy} onClick={() => void save()} size="sm">保存并通知成员</Button>
          </div>
        </div>
      ) : (
        <div className="group flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className={cn("line-clamp-2 leading-relaxed whitespace-pre-wrap", !brief.objective && "text-muted-foreground")}
              title={brief.objective || undefined}>
              <span className="mr-2 text-xs font-semibold tracking-wide text-muted-foreground">需求</span>
              {brief.objective || "还没写需求目标。写清楚要做成什么，统筹才好拆活。"}
            </p>
            {brief.currentFocus || brief.constraints.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {brief.currentFocus ? <Badge variant="secondary">当前重点：{brief.currentFocus}</Badge> : null}
                {brief.constraints.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}
              </div>
            ) : null}
          </div>
          <Button className="shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100" onClick={start} size="xs" variant="ghost">
            <Pencil /> 编辑
          </Button>
        </div>
      )}
    </section>
  );
}

/** 表单项：标签关联到 `id` 对应的输入（调用方把同一个 id 传给 Input / Textarea / SelectTrigger）。 */
function Field({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}{hint ? <span className="font-normal text-muted-foreground/70">（{hint}）</span> : null}
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
  const [view, setView] = useState<"chat" | "flow">("chat");
  const active = room.tasks.filter((task) => task.status === "active").length;
  return (
    <Tabs className="flex min-h-0 flex-1 flex-col gap-0" onValueChange={(value) => setView(value as "chat" | "flow")} value={view}>
      <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
        <TabsList className="h-8" variant="line">
          <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="chat"><MessagesSquare /> 对话</TabsTrigger>
          <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="flow">
            <Network /> 流程
            {active ? <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary tabular-nums">{active}</span> : null}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden" forceMount value="chat">
        {/* 每间房一份：未读分隔线、回到底部浮标都按进房那一刻算。 */}
        <Timeline key={room.id} room={room} rooms={rooms} />
      </TabsContent>
      <TabsContent className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden" value="flow">
        <RoomFlow onOpenSession={onOpenSession} room={room} tabs={tabs} />
      </TabsContent>
    </Tabs>
  );
}

// ---- 中栏：时间线 ----

function Timeline({ room, rooms }: { room: Room; rooms: RoomsState }) {
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // 代码滚到底之后，浏览器下一帧才派发 scroll 事件；那时上面可能刚冒出选择卡片、时间线变矮了，
  // 按那一刻量出来会误判成「用户翻上去了」。记下代码滚到的位置，落在这个位置上的事件不算用户滚动。
  const programmatic = useRef<number | null>(null);
  const [replyTo, setReplyTo] = useState<RoomMessage | null>(null);
  // 进房那一刻的已读位：分隔线画在它之后第一条发给你的消息前，在房间里一直留着，换房间才重算。
  const [seenAtOpen] = useState(() => readSeen(room.id));
  const divider = firstUnread(room.messages, seenAtOpen);
  // 翻上去看历史时新到的消息数：攒成「回到底部」浮标上的数字。
  const [away, setAway] = useState(false);
  const [awayFrom, setAwayFrom] = useState(0);
  const newer = away ? Math.max(0, room.messages.length - awayFrom) : 0;
  const last = room.messages.at(-1)?.id;
  // 看到底了，发给你的消息就算读过。
  const latest = latestToUser(room.messages);
  useEffect(() => { if (!away && latest) markSeen(room.id, latest); }, [away, latest, room.id]);
  const stick = () => {
    const node = list.current;
    if (!node || !pinned.current) return;
    node.scrollTop = node.scrollHeight;
    programmatic.current = node.scrollTop;
  };
  useEffect(stick, [last, room.id]);
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
  useEffect(() => setReplyTo(null), [room.id]);
  return (
    <>
      <div aria-label="房间对话" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-2 py-3" ref={list}
        onScroll={(event) => {
          const node = event.currentTarget;
          if (programmatic.current !== null && Math.abs(node.scrollTop - programmatic.current) < 2) {
            programmatic.current = null;
            return;
          }
          programmatic.current = null;
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
          if (pinned.current) stick();
          if (pinned.current === away) {
            setAway(!pinned.current);
            setAwayFrom(room.messages.length);
          }
        }}>
        <div ref={content} className={cn(room.messages.length === 0 && "h-full")}>
        {room.messages.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Inbox /></EmptyMedia>
              <EmptyTitle>还没有消息</EmptyTitle>
              <EmptyDescription>在下面跟统筹说需求；统筹会拆成任务派给成员，进展都会出现在这里。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {room.messages.map((message, index) => {
          const previous = room.messages[index - 1];
          const newDay = !previous || dayKey(previous.at) !== dayKey(message.at);
          return (
            <Fragment key={message.id}>
              {newDay ? (
                <div className="my-3 flex items-center gap-3 px-3" role="separator">
                  <Separator className="flex-1" />
                  <span className="text-xs font-medium text-muted-foreground">{dayLabel(message.at)}</span>
                  <Separator className="flex-1" />
                </div>
              ) : null}
              {index === divider ? (
                <div className="my-2 flex items-center gap-3 px-3" role="separator">
                  <Separator className="flex-1 bg-primary/50" />
                  <span className="text-xs font-semibold text-primary">新消息</span>
                  <Separator className="flex-1 bg-primary/50" />
                </div>
              ) : null}
              <MessageItem continued={!newDay && index !== divider && continues(previous, message)} message={message}
                onReply={() => setReplyTo(message)} room={room} rooms={rooms} />
            </Fragment>
          );
        })}
        </div>
      </div>
      {away ? (
        <div className="pointer-events-none relative h-0">
          <Button className="pointer-events-auto absolute right-5 bottom-3 z-10 rounded-full shadow-md"
            onClick={() => { pinned.current = true; setAway(false); stick(); }} size="sm" variant="secondary">
            <ArrowDown /> {newer ? `${newer} 条新消息` : "回到底部"}
          </Button>
        </div>
      ) : null}
      <Composer key={room.id} onSent={() => { pinned.current = true; setReplyTo(null); }} replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)} room={room} rooms={rooms} />
    </>
  );
}

function MessageItem({ room, rooms, message, continued, onReply }: {
  room: Room; rooms: RoomsState; message: RoomMessage; continued: boolean; onReply: () => void;
}) {
  const time = (
    <time className="text-xs text-muted-foreground tabular-nums" dateTime={new Date(message.at).toISOString()}
      title={new Date(message.at).toLocaleString()}>
      {formatTime(message.at)}
    </time>
  );
  if (message.kind === "notice") {
    const target = message.to.length ? message.to.map((id) => labelOf(room, id)).join("、") : null;
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
    [onOpenFile, room.projectRoot],
  );
  const quoted = message.replyTo ? room.messages.find((candidate) => candidate.id === message.replyTo) : undefined;
  const awaiting = awaitingReply(message);
  const delivery = deliveryState(room, message);
  const author = room.members.find((member) => member.id === message.by);
  const recipients = message.to.map((id) => labelOf(room, id)).join("、");
  return (
    <article className={cn("group relative flex gap-3 rounded-md px-3 pb-0.5 hover:bg-accent/40", continued ? "pt-0" : "mt-2.5 pt-1")}
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
              {author?.role === "foreman" ? <Crown aria-label="统筹" className="size-3.5 text-warning" /> : null}
            </span>
            {recipients ? <span className="text-xs text-muted-foreground">→ {recipients}</span> : null}
            {time}
            <span className="font-mono text-[11px] text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100"
              title="成员在终端里用这个编号回复">#{shortId(message.id)}</span>
          </header>
        ) : null}
        {message.replyTo ? (
          <blockquote className="mt-1 border-l-2 border-border pl-2.5 text-xs text-muted-foreground">
            {quoted ? <><span className="font-medium">{labelOf(room, quoted.by)}</span>：{excerpt(messageSummary(quoted), 80)}</> : "引用的消息已经不在了"}
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
                  <BellRing /> 等 {awaiting.map((id) => labelOf(room, id)).join("、")} 回复
                </Badge>
              ) : message.replyCancelled ? (
                <Badge variant="outline">已不再等回复</Badge>
              ) : (
                <Badge className="border-success/50 text-success" variant="outline"><CheckCheck /> 都回复了</Badge>
              )
            ) : null}
            {delivery ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground" title={delivery.title}>
                {delivery.pending ? <Clock className="size-3.5" /> : <CheckCheck className="size-3.5 text-success" />}
                {delivery.label}
              </span>
            ) : null}
          </footer>
        ) : null}
      </div>
      <div className="absolute top-0 right-3 flex -translate-y-1/2 gap-0.5 rounded-md border border-border bg-popover p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button onClick={onReply} size="xs" variant="ghost"><MessageSquareReply /> 回复</Button>
        {mine && awaiting.length ? (
          <Button onClick={() => void rooms.run(() => api.roomCancelReply(room.id, message.id))} size="xs" variant="ghost">不用回了</Button>
        ) : null}
      </div>
    </article>
  );
}

function Composer(props: { room: Room; rooms: RoomsState; replyTo: RoomMessage | null; onSent: () => void; onCancelReply: () => void }) {
  const { room, rooms, replyTo } = props;
  const [text, setText] = useState("");
  const [to, setTo] = useState(AUTO_RECIPIENT);
  // 默认要求回复：用户发的消息大多在等成员给个答复；只是通知一声时手动关掉。
  const [ask, setAsk] = useState(true);
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
  const sending = useRef(false);
  const pasteCount = useRef(0);
  const attachments = useRoomAttachments(room.id);
  const add = useRef(attachments.add);
  add.current = attachments.add;
  const options = recipientOptions(room);
  const noMembers = activeMembers(room).length === 0;
  const blocked = useRef(noMembers);
  blocked.current = noMembers;
  const full = attachments.items.length >= MAX_ATTACHMENTS;
  const busy = rooms.busy || attachments.pending || checkingPaste;
  const canSend = !noMembers && !busy && (text.trim() !== "" || attachments.items.length > 0);
  useEffect(() => { if (replyTo) input.current?.focus(); }, [replyTo]);

  // 拖文件进来：桌面端由原生拖放给出路径（webview 收不到文件的 HTML 拖放事件），浏览器里退回 HTML 拖放。
  // 落点算整个中栏，不必精确拖到输入框上；有对话框、菜单开着时不接。
  useEffect(() => {
    mounted.current = true;
    const zone = host.current?.closest("main") ?? host.current;
    const accepting = () => !sending.current && !blocked.current && !document.querySelector(OPEN_LAYER);
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
    if (sending.current) return;
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
    if (!canSend || sending.current || pasteCount.current > 0) return;
    const ids = attachments.beginSend();
    if (ids === null) return;
    sending.current = true;
    const recipients = to === AUTO_RECIPIENT ? [] : [to];
    const sent = await rooms.run(() => api.roomSay(room.id, text, recipients, replyTo?.id ?? null, ask && !replyTo, ids));
    sending.current = false;
    attachments.finishSend(sent !== null);
    if (sent) { setText(""); setAsk(true); props.onSent(); }
  };

  return (
    <div className="shrink-0 px-4 pt-1 pb-4">
      <div ref={host} className={cn(
        "group/composer relative rounded-lg border border-input bg-card shadow-xs transition-[border-color,box-shadow]",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30",
        noMembers && "opacity-60",
      )}>
        {replyTo ? (
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
            <MessageSquareReply className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              回复 <span className="font-medium text-foreground">{labelOf(room, replyTo.by)}</span>：{excerpt(messageSummary(replyTo), 60)}
            </span>
            <Button aria-label="取消回复" onClick={props.onCancelReply} size="icon-xs" variant="ghost"><X /></Button>
          </div>
        ) : null}
        <Textarea aria-label="消息" disabled={noMembers} ref={input} rows={2} value={text}
          className="min-h-14 resize-none border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          onChange={(event) => { setText(event.target.value); trackMention(event.target.value, event.target.selectionStart); }}
          onClick={(event) => trackMention(event.currentTarget.value, event.currentTarget.selectionStart)}
          onBlur={() => window.setTimeout(() => setMention(null), 120)}
          onPaste={(event) => void paste(event)}
          placeholder={noMembers ? "先添加成员"
            : replyTo ? "写回复…（默认回给原发件人）"
              : "跟统筹说需求、问进度…  @角色 只发给那个人；文件可以拖进来或直接粘贴"}
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
          <div aria-label="点名" className="absolute bottom-full left-2 z-30 mb-1.5 w-80 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg" role="listbox">
            <div className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground">点名只发给这个人 · ↑↓ 选择，Enter 确定</div>
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
          <div aria-label="待发送的附件" aria-live="polite" className="flex flex-wrap gap-2 px-3 pt-1 pb-2.5">
            {attachments.items.map((item) => (
              <AttachmentCard attachment={item.attachment} disabled={rooms.busy} key={item.key} name={item.name}
                onRemove={() => attachments.remove(item.key)} roomId={room.id} size={item.size} />
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button aria-label="添加文件" className="size-7 text-muted-foreground hover:text-foreground"
                  disabled={noMembers || full || rooms.busy} onClick={() => void attachments.pick()} size="icon-sm" variant="ghost">
                  <Paperclip />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {full ? `每条消息最多 ${MAX_ATTACHMENTS} 个附件` : "添加文件。也可以拖进来或直接粘贴；每条最多 10 个，单个不超过 20 MB。"}
            </TooltipContent>
          </Tooltip>
          <Separator className="mx-0.5 h-4" orientation="vertical" />
          <Select disabled={noMembers || replyTo !== null} onValueChange={setTo} value={to}>
            <SelectTrigger aria-label="收件人" className="h-7 max-w-52 gap-1.5 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-accent dark:bg-transparent" size="sm">
              <span className="text-muted-foreground">发给</span>
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
                <Toggle aria-label="要求回复" disabled={noMembers || replyTo !== null} onPressedChange={setAsk}
                  pressed={ask && !replyTo} size="sm" variant="outline"
                  className={cn(
                    "h-7 gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground shadow-none",
                    "data-[state=on]:border-primary/50 data-[state=on]:bg-primary/15 data-[state=on]:text-primary",
                    "hover:data-[state=on]:bg-primary/20 hover:data-[state=on]:text-primary",
                  )}>
                  <BellRing className="size-3.5" />
                  要求回复
                </Toggle>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {replyTo
                ? "回复不能再要求回复"
                : ask ? "开着：收件人回复之前，这条消息一直挂着「等回复」。只是通知一声时关掉。" : "关着：发出去就算，不要求对方回复。"}
            </TooltipContent>
          </Tooltip>
          <span className="ml-auto hidden items-center gap-1 text-[11px] text-muted-foreground/70 min-[1200px]:group-focus-within/composer:flex">
            {attachments.items.length ? `${attachments.items.length}/${MAX_ATTACHMENTS} 个附件 · ` : null}
            <Kbd>Enter</Kbd> 发送 · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> 换行
          </span>
          <Button aria-label="发送" className="ml-auto min-[1200px]:group-focus-within/composer:ml-0" disabled={!canSend} onClick={() => void send()} size="icon-sm">
            {busy ? <Spinner /> : <SendHorizontal />}
          </Button>
        </div>
      </div>
      {attachments.error ? (
        <p className="mt-1.5 flex items-center gap-1.5 px-1 text-xs text-destructive" role="alert">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="flex-1">{attachments.error}</span>
          <Button aria-label="关闭附件提示" onClick={attachments.clearError} size="icon-xs" variant="ghost"><X /></Button>
        </p>
      ) : null}
      {dragging ? (
        <div aria-hidden="true"
          className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/60 bg-background/85 backdrop-blur-sm">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary"><Paperclip className="size-6" /></span>
          <span className="font-medium">松开即可添加文件</span>
          <span className="text-xs text-muted-foreground">每条最多 {MAX_ATTACHMENTS} 个 · 单个不超过 20 MB</span>
        </div>
      ) : null}
    </div>
  );
}

// ---- 右栏：任务板 ----

function TaskBoard({ room, rooms }: { room: Room; rooms: RoomsState }) {
  const [adding, setAdding] = useState(false);
  const columns = taskColumns(room);
  const archived = room.tasks.filter((task) => task.status === "archived").length;
  const live = room.tasks.length - archived;
  useEffect(() => setAdding(false), [room.id]);
  return (
    <aside aria-label="任务板" className="flex min-h-0 flex-col border-l border-border bg-(--panel)">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <ListTodo className="size-4 text-muted-foreground" />
        <span className="font-semibold">任务板</span>
        <span className="text-xs text-muted-foreground">{live}</span>
        <Button className="ml-auto" onClick={() => setAdding((value) => !value)} size="xs" variant={adding ? "secondary" : "outline"}>
          <Plus /> 新建任务
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {adding ? <TaskForm onDone={() => setAdding(false)} room={room} rooms={rooms} /> : null}
        {room.tasks.length === 0 && !adding ? (
          <Empty className="flex-none border border-dashed border-border py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon"><ListTodo /></EmptyMedia>
              <EmptyTitle className="text-sm">任务板是空的</EmptyTitle>
              <EmptyDescription className="text-xs">通常由统筹拆需求、建任务；你也可以直接在这里建。</EmptyDescription>
            </EmptyHeader>
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
        {archived ? <p className="px-0.5 text-xs text-muted-foreground"><Archive className="mr-1 inline size-3" />已归档 {archived} 条</p> : null}
      </div>
    </aside>
  );
}

function TaskCard({ room, rooms, task }: { room: Room; rooms: RoomsState; task: RoomTask }) {
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
            : <span className="italic">没人负责</span>}
          {blockers.length ? <Badge className="ml-auto h-5 border-warning/50 px-1.5 text-[11px] text-warning" variant="outline">等 {blockers.join("、")}</Badge> : null}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2.5 border-t border-border bg-background/40 px-3 py-2.5 text-xs">
          {task.outcome ? <Detail label="完成标准">{task.outcome}</Detail> : null}
          {task.result ? <Detail label="结果">{task.result}</Detail> : null}
          {task.notes ? (
            <Detail label="进展">
              <pre className="max-h-32 overflow-auto rounded-md bg-muted px-2 py-1.5 font-sans whitespace-pre-wrap">{task.notes}</pre>
            </Detail>
          ) : null}
          {task.status !== "done" && task.status !== "archived" ? (
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-muted-foreground">负责人</span>
              <Select onValueChange={(value) => run({ op: "assign", task: task.id, assignee: value })} value={assignee?.title ?? ""}>
                <SelectTrigger aria-label="负责人" className="h-7 flex-1 text-xs" size="sm"><SelectValue placeholder="没人负责" /></SelectTrigger>
                <SelectContent>
                  {activeMembers(room).map((member) => <SelectItem key={member.id} value={member.title}>{member.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <p className="text-muted-foreground/80">由 {labelOf(room, task.createdBy)} 创建 · {formatTime(task.createdAt)}</p>
          <div className="flex flex-wrap gap-1.5">
            {task.status === "planned" ? (
              <Button disabled={blockers.length > 0} onClick={() => run({ op: "start", task: task.id })} size="xs" variant="outline"><Play /> 开工</Button>
            ) : null}
            {task.status === "planned" || task.status === "active" ? (
              <Button onClick={() => run({ op: "done", task: task.id })} size="xs"><Check /> 完成</Button>
            ) : null}
            {task.status === "active" || task.status === "done" ? (
              <Button onClick={() => run({ op: "reopen", task: task.id })} size="xs" variant="outline"><RotateCcw /> 退回</Button>
            ) : null}
            <Button className="ml-auto text-muted-foreground" onClick={() => run({ op: "archive", task: task.id })} size="xs" variant="ghost">
              <Archive /> 归档
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function TaskStatusIcon({ status }: { status: TaskStatus }) {
  const icon = {
    planned: <CircleDashed className="size-4 text-muted-foreground" />,
    active: <CircleDot className="size-4 text-primary" />,
    done: <CircleCheck className="size-4 text-success" />,
    archived: <Archive className="size-4 text-muted-foreground" />,
  }[status];
  return <span aria-label={STATUS_LABEL[status]} className="mt-px shrink-0" role="img" title={STATUS_LABEL[status]}>{icon}</span>;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 leading-relaxed whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function TaskForm({ room, rooms, onDone }: { room: Room; rooms: RoomsState; onDone: () => void }) {
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
      <Input aria-label="任务标题" autoFocus maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="任务标题" value={title} />
      <Textarea aria-label="完成标准" className="min-h-14 text-sm" onChange={(event) => setOutcome(event.target.value)}
        placeholder="完成标准（选填）" rows={2} value={outcome} />
      <Select onValueChange={setAssignee} value={assignee}>
        <SelectTrigger aria-label="负责人" className="w-full" size="sm"><SelectValue placeholder="负责人：暂不指定" /></SelectTrigger>
        <SelectContent>
          {activeMembers(room).map((member) => <SelectItem key={member.id} value={member.title}>{member.title}</SelectItem>)}
        </SelectContent>
      </Select>
      {open.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">要等这些完成（选填）</span>
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
        <Button onClick={onDone} size="sm" type="button" variant="ghost">取消</Button>
        <Button disabled={!title.trim() || rooms.busy} size="sm" type="submit">建任务</Button>
      </div>
    </form>
  );
}

// ---- 对话框 ----

function agentOptions(agents: AgentAvailability[]) {
  return agents
    .filter((agent) => agent.available && (agent.kind === "claude" || agent.kind === "codex"))
    .map((agent) => ({ value: agent.kind, label: agent.descriptor.displayName }));
}

/** 拉起一位成员：开会话、进房间、起协作名。返回失败理由或 null。 */
async function launchInto(
  room: Room, row: RosterRow & { kind: AgentKind }, foreman: boolean,
  launch: NonNullable<RoomViewProps["onLaunchMember"]>, rename: RoomViewProps["onRenameAgent"],
): Promise<string | null> {
  const tabId = await launch(row.kind, room.projectRoot);
  if (!tabId) return `「${row.title}」的会话没起来`;
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
  agents: AgentAvailability[]; project: ProjectWorkspace; rooms: RoomsState; onClose: () => void;
  onLaunchMember?: RoomViewProps["onLaunchMember"]; onRenameAgent?: RoomViewProps["onRenameAgent"];
}) {
  const id = useId();
  const kinds = agentOptions(props.agents);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [roster, setRoster] = useState<(RosterRow & { kind: AgentKind })[]>(
    () => DEFAULT_ROSTER.map((row) => ({ ...row, kind: (kinds[0]?.value ?? "claude") as AgentKind })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canLaunch = Boolean(props.onLaunchMember) && kinds.length > 0;
  const rowErrors = roster.map((row, index) => titleError(row.title, roster.filter((_, other) => other !== index).map((r) => r.title)));
  const update = (index: number, patch: Partial<RosterRow & { kind: AgentKind }>) =>
    setRoster((rows) => rows.map((row, at) => at === index ? { ...row, ...patch } : row));
  const submit = async () => {
    if (!name.trim() || busy || (canLaunch && rowErrors.some(Boolean))) return;
    setBusy(true);
    setError(null);
    const room = await props.rooms.create(name, props.project.rootPath, objective);
    if (room && canLaunch && props.onLaunchMember) {
      // 逐个拉起；任何一步失败就停，已经建好的房间和成员都保留——半路回滚会丢掉已经起好的会话。
      for (const [index, row] of roster.entries()) {
        const reason = await launchInto(room, row, index === 0, props.onLaunchMember, props.onRenameAgent);
        if (reason) { setError(`${reason}；房间已建好，缺的成员可以在左栏「添加成员」补上。`); setBusy(false); void props.rooms.refresh(); return; }
      }
      void props.rooms.refresh();
    }
    setBusy(false);
    if (room) props.onClose();
  };
  const { onOpenChange, ...guards } = guardedClose(busy, props.onClose);
  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent className="gap-5 sm:max-w-2xl" {...guards}>
        <DialogHeader>
          <DialogTitle>新建房间</DialogTitle>
          <DialogDescription>一间房对应一个需求。第一行的角色当统筹：负责拆需求、派活、跟进度；其他人各管自己的职责。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field id={`${id}-name`} label="房间名">
            <Input autoFocus id={`${id}-name`} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="比如：登录页改版" value={name} />
          </Field>
          <Field id={`${id}-objective`} label="需求目标">
            <Textarea className="min-h-20" id={`${id}-objective`} onChange={(event) => setObjective(event.target.value)} placeholder="要做成什么样？统筹会据此拆任务" rows={3} value={objective} />
          </Field>
          {canLaunch ? (
            <Field label={`班子（在项目「${props.project.name}」里各开一条会话）`}>
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="grid grid-cols-[64px_120px_minmax(0,1fr)_128px_32px] gap-2 border-b border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  <span>身份</span><span>角色名</span><span>职责</span><span>Agent</span><span />
                </div>
                {roster.map((row, index) => (
                  <div className="grid grid-cols-[64px_120px_minmax(0,1fr)_128px_32px] items-center gap-2 border-b border-border px-3 py-2 last:border-b-0" key={index}>
                    {index === 0 ? (
                      <Badge className="border-warning/50 text-warning" variant="outline"><Crown /> 统筹</Badge>
                    ) : <Badge variant="secondary">成员</Badge>}
                    <Input aria-invalid={Boolean(rowErrors[index])} aria-label="角色名" className="h-8"
                      onChange={(event) => update(index, { title: event.target.value })} title={rowErrors[index] ?? undefined} value={row.title} />
                    <Input aria-label="职责" className="h-8" onChange={(event) => update(index, { duty: event.target.value })} placeholder="职责" value={row.duty} />
                    <Select onValueChange={(kind) => update(index, { kind: kind as AgentKind })} value={row.kind}>
                      <SelectTrigger aria-label="Agent" className="w-full" size="sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {kinds.map((kind) => <SelectItem key={kind.value} value={kind.value}>{kind.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button aria-label="删掉这一行" disabled={roster.length === 1} size="icon-sm" variant="ghost"
                      onClick={() => setRoster((rows) => rows.filter((_, at) => at !== index))}>
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
              <Button className="self-start" onClick={() => setRoster((rows) => [...rows, { title: "", duty: "", kind: rows[0]?.kind ?? "claude" }])}
                size="xs" variant="ghost">
                <Plus /> 加一位成员
              </Button>
              {rowErrors.find(Boolean) ? <p className="text-xs text-destructive">{rowErrors.find(Boolean)}</p> : null}
            </Field>
          ) : (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
              没有检测到可用的 Claude / Codex：先只建房间，成员之后在左栏添加。
            </p>
          )}
          {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={props.onClose} variant="outline">取消</Button>
          <Button disabled={busy || !name.trim() || (canLaunch && rowErrors.some(Boolean))} onClick={() => void submit()}>
            {busy ? <><Spinner /> 正在拉起成员…</> : "创建"}
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
  const { room } = props;
  const id = useId();
  const kinds = agentOptions(props.agents);
  const taken = new Set(props.rooms.rooms.flatMap((summary) => summary.memberTabIds));
  const existing = props.tabs.filter((tab) => isAgentKind(tab.kind) && tab.phase === "running" && !taken.has(tab.id));
  const sources = [
    ...(props.onLaunchMember ? kinds.map((kind) => ({ value: `new:${kind.value}`, label: `新开一条 ${kind.label} 会话` })) : []),
    ...existing.map((tab) => ({ value: `tab:${tab.id}`, label: `已有会话：${tab.agentName ?? tab.title}` })),
  ];
  const [source, setSource] = useState(sources[0]?.value ?? "");
  const [title, setTitle] = useState("");
  const [duty, setDuty] = useState("");
  const [foreman, setForeman] = useState(foremanOf(room) === null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      if (!added) reason = "没加进去，看右下角的提示";
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
          <DialogTitle>添加成员</DialogTitle>
          <DialogDescription>新开一条 Agent 会话，或把一条已有的会话拉进房间。加入后会收到上手说明。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field id={`${id}-source`} label="会话">
            <Select disabled={!sources.length} onValueChange={setSource} value={source}>
              <SelectTrigger className="w-full" id={`${id}-source`}><SelectValue placeholder="没有可用的会话" /></SelectTrigger>
              <SelectContent>
                {sources.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field id={`${id}-title`} label="角色名">
            <Input aria-invalid={Boolean(title) && Boolean(invalid)} autoFocus id={`${id}-title`} maxLength={24}
              onChange={(event) => setTitle(event.target.value)} placeholder="比如：测试" value={title} />
            {title && invalid ? <p className="text-xs text-destructive">{invalid}</p> : null}
          </Field>
          <Field id={`${id}-duty`} label="职责">
            <Input id={`${id}-duty`} onChange={(event) => setDuty(event.target.value)} placeholder="他负责什么" value={duty} />
          </Field>
          <Label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 font-normal">
            <Checkbox checked={foreman} className="mt-0.5" onCheckedChange={(checked) => setForeman(checked === true)} />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">当统筹</span>
              <span className="text-xs text-muted-foreground">
                {current ? `会替换现在的「${current.title}」，他改为成员。` : "房间里还没有统筹。"}
              </span>
            </span>
          </Label>
          {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={props.onClose} variant="outline">取消</Button>
          <Button disabled={busy || Boolean(invalid) || !source} onClick={() => void submit()}>
            {busy ? <><Spinner /> 正在添加…</> : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
