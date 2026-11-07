import { AlertTriangle, Crown, MessageSquareReply, Plus, SquareTerminal, Trash2, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isAgentKind, type AgentAvailability, type AgentKind } from "../../agent/contracts";
import { Checkbox } from "../../components/controls/Checkbox";
import { Select } from "../../components/controls/Select";
import { useDialog } from "../../components/controls/useDialog";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ICON } from "../../theme/sizing";
import { composingKey } from "../../utils/keyboard";
import "../tailwind.css";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Separator } from "../../components/ui/separator";
import { Textarea } from "../../components/ui/textarea";
import type { PausedDelivery } from "../../prompt/runtime";
import type { TerminalChoice } from "../../terminal/choice";
import type { TerminalCommandTarget } from "../../terminal/contracts";
import type { ProjectWorkspace, WorkspaceTab } from "../../workspace/contracts";
import * as api from "../api";
import type { Room, RoomMember, RoomMessage, RoomTask } from "../contracts";
import {
  activeMembers, awaitingReply, DEFAULT_ROSTER, deliveryNote, excerpt, foremanOf, formatTime, labelOf, openBlockers,
  progress, recipientOptions, shortId, STATUS_LABEL, taskColumns, titleError, workload, type RosterRow,
} from "../model";
import { useRooms, type RoomsState } from "../useRooms";
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
}

type Dialog =
  | { kind: "new-room" }
  | { kind: "add-member" }
  | { kind: "delete-room"; room: Room }
  | { kind: "remove-member"; member: RoomMember };

export function RoomView(props: RoomViewProps) {
  const rooms = useRooms();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const room = rooms.room;

  // Escape 关整个视图；对话框的 Escape 由 useDialog 先截走。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || composingKey(event) || dialog) return;
      props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, props.onClose]);

  const ordered = useMemo(
    () => [...rooms.rooms].sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)),
    [rooms.rooms],
  );
  const close = () => setDialog(null);
  const canCreate = props.project !== null && rooms.loadError === null;

  return (
    <section aria-label="协作房间" className="room-view">
      <aside className="room-rail">
        <header className="room-rail__head">
          <strong>协作房间</strong>
          <button aria-label="新建房间" className="room-icon-button" disabled={!canCreate}
            onClick={() => setDialog({ kind: "new-room" })}
            title={props.project ? "新建房间" : "先在左侧打开一个项目，房间归属项目"} type="button">
            <Plus aria-hidden="true" size={ICON.md} />
          </button>
          <button aria-label="关闭房间" className="room-icon-button" onClick={props.onClose} title="关闭（Esc）" type="button">
            <X aria-hidden="true" size={ICON.md} />
          </button>
        </header>
        {rooms.loadError ? <p className="room-rail__notice" role="alert">{rooms.loadError}</p> : null}
        <nav aria-label="房间列表" className="room-list">
          {ordered.map((summary) => (
            <button aria-current={summary.id === rooms.selectedId} key={summary.id}
              className={`room-list__item${summary.id === rooms.selectedId ? " is-active" : ""}`}
              onClick={() => rooms.select(summary.id)} title={summary.projectRoot} type="button">
              <span className="room-list__title">{summary.name}</span>
              <span className="room-list__meta">
                {summary.memberCount} 人 · 任务 {summary.doneTasks}/{summary.doneTasks + summary.openTasks}
              </span>
            </button>
          ))}
          {ordered.length === 0 ? (
            <p className="room-rail__hint">
              还没有房间。房间里一位统筹负责拆需求、派活、跟进度，其他成员各管自己的职责，一起把一个需求做完。
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
          <main className="room-stream">
            <RoomHeader onDelete={() => setDialog({ kind: "delete-room", room })} room={room} rooms={rooms} />
            <AttentionPanel onOpenSession={props.onOpenSession} onResume={props.onResumeDelivery}
              paused={props.pausedDeliveries ?? []} room={room} tabs={props.tabs} targets={props.targets} />
            <BriefPanel room={room} rooms={rooms} />
            <Timeline room={room} rooms={rooms} />
          </main>
          <TaskBoard room={room} rooms={rooms} />
        </>
      ) : (
        <main className="room-stream room-stream--empty">
          <p>{ordered.length ? "选一间房。" : "新建一间房，写下要完成的需求，再拉几个 Agent 进来。"}</p>
          {canCreate && !ordered.length ? (
            <button className="room-primary" onClick={() => setDialog({ kind: "new-room" })} type="button">新建房间</button>
          ) : null}
        </main>
      )}

      {rooms.error ? (
        <div className="room-toast" role="alert">
          <span>{rooms.error}</span>
          <button aria-label="关闭提示" onClick={rooms.dismissError} type="button"><X aria-hidden="true" size={ICON.sm} /></button>
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
        <ConfirmDialog body={`房间、任务板和聊天记录都会删掉，找不回来。成员的会话不受影响。`}
          confirmLabel="删除" onCancel={close}
          onConfirm={() => { close(); void rooms.remove(dialog.room.id); }} title={`删除「${dialog.room.name}」？`} />
      ) : null}
      {dialog?.kind === "remove-member" && room ? (
        <ConfirmDialog body="会话不会关掉；他手上没做完的任务会交还统筹重新分派。" confirmLabel="移出"
          onCancel={close} title={`把「${dialog.member.title}」移出房间？`}
          onConfirm={() => { close(); void rooms.run(() => api.roomRemoveMember(room.id, dialog.member.id)); }} />
      ) : null}
    </section>
  );
}

// ---- 左栏：成员 ----

function MemberList(props: {
  room: Room; rooms: RoomsState; tabs: WorkspaceTab[];
  onAdd: () => void; onRemove: (member: RoomMember) => void; onOpenSession?: (tabId: string) => void;
}) {
  const { room, rooms } = props;
  return (
    <section aria-label="成员" className="room-members">
      <header className="room-section-head">
        <span>成员</span>
        <button aria-label="添加成员" className="room-icon-button" onClick={props.onAdd} title="添加成员" type="button">
          <UserPlus aria-hidden="true" size={ICON.sm} />
        </button>
      </header>
      {activeMembers(room).map((member) => {
        const tab = props.tabs.find((candidate) => candidate.id === member.tabId);
        const state = !tab || tab.phase !== "running" ? "离线" : tab.activity === "talking" ? "忙" : tab.activity === "awaiting-choice" ? "等你选择" : "空闲";
        const load = workload(room, member.id);
        return (
          <div className={`room-member${state === "等你选择" ? " room-member--waiting" : ""}`} key={member.id}>
            <div className="room-member__main">
              <span className="room-member__title">
                {member.role === "foreman" ? <Crown aria-label="统筹" className="room-member__crown" size={ICON.xs} /> : null}
                {member.title}
              </span>
              <span className={`room-member__state room-member__state--${state === "忙" ? "busy" : state === "离线" ? "off" : state === "等你选择" ? "wait" : "idle"}`}>{state}</span>
            </div>
            <span className="room-member__duty">{member.duty || "（未写职责）"}{load ? ` · 手上 ${load} 件` : ""}</span>
            <div className="room-member__actions">
              {tab && props.onOpenSession ? (
                <button onClick={() => props.onOpenSession?.(tab.id)} title="看他的终端" type="button">
                  <SquareTerminal aria-hidden="true" size={ICON.xs} /> 终端
                </button>
              ) : null}
              {member.role !== "foreman" ? (
                <button onClick={() => void rooms.run(() => api.roomSetForeman(room.id, member.id))} type="button">设为统筹</button>
              ) : null}
              <button onClick={() => props.onRemove(member)} type="button">移出</button>
            </div>
          </div>
        );
      })}
      {activeMembers(room).length === 0 ? <p className="room-rail__hint">还没有成员。第一位加入的成员自动当统筹。</p> : null}
    </section>
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
  const waiting = members.filter((member) => {
    const tab = tabs.find((candidate) => candidate.id === member.tabId);
    return tab?.phase === "running" && tab.activity === "awaiting-choice";
  });
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
    <section aria-label="需要你处理" className="room-attention">
      {waiting.map((member) => {
        const choice = choices.get(member.tabId) ?? null;
        return (
          <article className="room-attention__card" key={member.id} role="alert">
            <header className="room-attention__head">
              <AlertTriangle aria-hidden="true" size={ICON.sm} />
              <strong>「{member.title}」在等你选择</strong>
              {props.onOpenSession ? (
                <button className="room-link" onClick={() => props.onOpenSession?.(member.tabId)} type="button">去终端处理</button>
              ) : null}
            </header>
            {choice ? (
              <>
                <p className="room-attention__question">{choice.question}</p>
                {choice.detail ? <pre className="room-attention__detail">{choice.detail}</pre> : null}
                <div className="room-attention__options">
                  {choice.options.map((option) => (
                    <button className={option.index === choice.selected ? "is-selected" : undefined} key={option.index}
                      onClick={() => answer(member, choice, option.index)} type="button">
                      {option.index}. {option.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="room-attention__hint">没读出选项（可能要你打字回答，或界面是我们不认得的样子），去终端里处理。</p>
            )}
            {notes.get(member.tabId) ? <p className="room-attention__note">{notes.get(member.tabId)}</p> : null}
          </article>
        );
      })}
      {stuck.map((member) => (
        <article className="room-attention__card room-attention__card--stuck" key={`stuck-${member.id}`}>
          <header className="room-attention__head">
            <AlertTriangle aria-hidden="true" size={ICON.sm} />
            <strong>发给「{member.title}」的消息暂停了</strong>
          </header>
          <p className="room-attention__hint">
            没能确认上一条消息被提交，后面的消息先不送，免得重复粘贴。看一眼他的输入区：已经提交了就点「继续投递」；还卡在输入区就去终端按一下回车。
          </p>
          <div className="room-row-actions">
            {props.onOpenSession ? <button onClick={() => props.onOpenSession?.(member.tabId)} type="button">去终端看看</button> : null}
            <button className="room-primary" onClick={() => props.onResume?.(member.tabId)} type="button">继续投递</button>
          </div>
        </article>
      ))}
    </section>
  );
}

// ---- 中栏：标题、简报、时间线 ----

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
    <header className="room-header">
      {editing ? (
        <input aria-label="房间名" autoFocus className="room-input room-header__input" onBlur={() => void save()}
          onChange={(event) => setName(event.target.value)} value={name}
          onKeyDown={(event) => {
            if (composingKey(event)) return;
            if (event.key === "Enter") void save();
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setName(room.name); setEditing(false); }
          }} />
      ) : (
        <button className="room-header__name" onClick={() => setEditing(true)} title="改名" type="button">{room.name}</button>
      )}
      <span className="room-header__meta">{room.projectRoot}</span>
      <span className="room-header__progress" title="已完成 / 任务总数（不含归档）">
        <span className="room-progress"><span style={{ width: total ? `${(done / total) * 100}%` : 0 }} /></span>
        {done}/{total}
      </span>
      <button aria-label="删除房间" className="room-icon-button" onClick={onDelete} title="删除房间" type="button">
        <Trash2 aria-hidden="true" size={ICON.sm} />
      </button>
    </header>
  );
}

function BriefPanel({ room, rooms }: { room: Room; rooms: RoomsState }) {
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
  if (editing) {
    return (
      <section aria-label="需求简报" className="room-brief room-brief--editing">
        <label className="room-field"><span>需求目标</span>
          <textarea className="room-input" onChange={(event) => setObjective(event.target.value)} rows={3} value={objective} />
        </label>
        <label className="room-field"><span>当前重点</span>
          <input className="room-input" onChange={(event) => setFocus(event.target.value)} value={focus} />
        </label>
        <label className="room-field"><span>约束（一行一条）</span>
          <textarea className="room-input" onChange={(event) => setConstraints(event.target.value)} rows={2} value={constraints} />
        </label>
        <div className="room-row-actions">
          <button onClick={() => setEditing(false)} type="button">取消</button>
          <button className="room-primary" disabled={rooms.busy} onClick={() => void save()} type="button">保存并通知成员</button>
        </div>
      </section>
    );
  }
  const brief = room.brief;
  return (
    <section aria-label="需求简报" className="room-brief">
      <div className="room-brief__body">
        <p className="room-brief__objective">{brief.objective || "还没写需求目标。写清楚要做成什么，统筹才好拆活。"}</p>
        {brief.currentFocus ? <p className="room-brief__line"><b>当前重点</b>{brief.currentFocus}</p> : null}
        {brief.constraints.length ? <p className="room-brief__line"><b>约束</b>{brief.constraints.join("；")}</p> : null}
      </div>
      <button className="room-link" onClick={start} type="button">编辑</button>
    </section>
  );
}

function Timeline({ room, rooms }: { room: Room; rooms: RoomsState }) {
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [replyTo, setReplyTo] = useState<RoomMessage | null>(null);
  const last = room.messages.at(-1)?.id;
  useEffect(() => {
    const node = list.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [last, room.id]);
  useEffect(() => setReplyTo(null), [room.id]);
  return (
    <>
      <div aria-label="房间对话" aria-live="polite" className="room-timeline" ref={list}
        onScroll={(event) => {
          const node = event.currentTarget;
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
        }}>
        {room.messages.length === 0 ? <p className="room-timeline__empty">还没有消息。</p> : null}
        {room.messages.map((message) => (
          <MessageItem key={message.id} message={message} onReply={() => setReplyTo(message)} room={room} rooms={rooms} />
        ))}
      </div>
      <Composer onSent={() => { pinned.current = true; setReplyTo(null); }} replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)} room={room} rooms={rooms} />
    </>
  );
}

function MessageItem({ room, rooms, message, onReply }: { room: Room; rooms: RoomsState; message: RoomMessage; onReply: () => void }) {
  if (message.kind === "notice") {
    const target = message.to.length ? ` → ${message.to.map((id) => labelOf(room, id)).join("、")}` : "";
    return (
      <div className="room-notice">
        <span className="room-notice__text">{message.text}{target ? <span className="room-notice__to">{target}</span> : null}</span>
        <time dateTime={new Date(message.at).toISOString()}>{formatTime(message.at)}</time>
      </div>
    );
  }
  const mine = message.by === "user";
  const quoted = message.replyTo ? room.messages.find((candidate) => candidate.id === message.replyTo) : undefined;
  const awaiting = awaitingReply(message);
  const note = deliveryNote(room, message);
  const author = room.members.find((member) => member.id === message.by);
  return (
    <article className={`room-message${mine ? " room-message--mine" : ""}`} id={`room-message-${message.id}`}>
      <header className="room-message__head">
        <span className="room-message__author">
          {author?.role === "foreman" ? <Crown aria-label="统筹" className="room-member__crown" size={ICON.xs} /> : null}
          {labelOf(room, message.by)}
        </span>
        <span className="room-message__to">→ {message.to.map((id) => labelOf(room, id)).join("、")}</span>
        <time dateTime={new Date(message.at).toISOString()} title={new Date(message.at).toLocaleString()}>{formatTime(message.at)}</time>
        <span className="room-message__id" title="成员在终端里用这个编号回复">{shortId(message.id)}</span>
      </header>
      {message.replyTo ? (
        <blockquote className="room-message__quote">
          {quoted ? `${labelOf(room, quoted.by)}：${excerpt(quoted.text, 80)}` : "引用的消息已经不在了"}
        </blockquote>
      ) : null}
      <p className="room-message__text">{message.text}</p>
      <footer className="room-message__foot">
        {message.mode === "request_reply" ? (
          awaiting.length ? (
            <span className="room-badge room-badge--wait">等 {awaiting.map((id) => labelOf(room, id)).join("、")} 回复</span>
          ) : message.replyCancelled ? (
            <span className="room-badge">已不再等回复</span>
          ) : (
            <span className="room-badge room-badge--ok">都回复了</span>
          )
        ) : null}
        {note ? <span className="room-message__note">{note}</span> : null}
        <span className="room-message__actions">
          <button onClick={onReply} type="button"><MessageSquareReply aria-hidden="true" size={ICON.xs} /> 回复</button>
          {mine && awaiting.length ? (
            <button onClick={() => void rooms.run(() => api.roomCancelReply(room.id, message.id))} type="button">不用回了</button>
          ) : null}
        </span>
      </footer>
    </article>
  );
}

function Composer(props: { room: Room; rooms: RoomsState; replyTo: RoomMessage | null; onSent: () => void; onCancelReply: () => void }) {
  const { room, rooms, replyTo } = props;
  const [text, setText] = useState("");
  const [to, setTo] = useState("");
  const [ask, setAsk] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const options = recipientOptions(room);
  useEffect(() => { setTo(""); setAsk(false); setText(""); }, [room.id]);
  useEffect(() => { if (replyTo) input.current?.focus(); }, [replyTo]);
  const noMembers = activeMembers(room).length === 0;
  const send = async () => {
    if (!text.trim() || rooms.busy) return;
    const recipients = to ? [to] : [];
    const sent = await rooms.run(() => api.roomSay(room.id, text, recipients, replyTo?.id ?? null, ask && !replyTo));
    if (sent) { setText(""); setAsk(false); props.onSent(); }
  };
  return (
    <div className="room-composer">
      {replyTo ? (
        <div className="room-composer__reply">
          <span>回复 {labelOf(room, replyTo.by)}：{excerpt(replyTo.text, 60)}</span>
          <button aria-label="取消回复" onClick={props.onCancelReply} type="button"><X aria-hidden="true" size={ICON.xs} /></button>
        </div>
      ) : null}
      <textarea aria-label="消息" className="room-input room-composer__input" disabled={noMembers}
        onChange={(event) => setText(event.target.value)} ref={input} rows={3} value={text}
        placeholder={noMembers ? "先添加成员" : replyTo ? "写回复…（默认回给原发件人）" : "跟统筹说需求、问进度…  @角色 只发给那个人；Enter 发送，Shift+Enter 换行"}
        onKeyDown={(event) => {
          if (composingKey(event)) return;
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
        }} />
      <div className="room-composer__bar">
        <span className="room-composer__label">发给</span>
        <Select ariaLabel="收件人" className="room-composer__to" disabled={noMembers || replyTo !== null}
          onChange={setTo} options={options} value={to} />
        <Checkbox checked={ask && !replyTo} disabled={noMembers || replyTo !== null} onChange={setAsk}>要求回复</Checkbox>
        <button className="room-primary" disabled={noMembers || !text.trim() || rooms.busy} onClick={() => void send()} type="button">发送</button>
      </div>
    </div>
  );
}

// ---- 右栏：任务板 ----

function TaskBoard({ room, rooms }: { room: Room; rooms: RoomsState }) {
  const [adding, setAdding] = useState(false);
  const columns = taskColumns(room);
  const archived = room.tasks.filter((task) => task.status === "archived").length;
  useEffect(() => setAdding(false), [room.id]);
  return (
    <aside aria-label="任务板" className="room-board">
      <header className="room-section-head">
        <span>任务板</span>
        <button aria-label="新建任务" className="room-icon-button" onClick={() => setAdding((value) => !value)} title="新建任务" type="button">
          <Plus aria-hidden="true" size={ICON.sm} />
        </button>
      </header>
      {adding ? <TaskForm onDone={() => setAdding(false)} room={room} rooms={rooms} /> : null}
      {room.tasks.length === 0 && !adding ? (
        <p className="room-rail__hint">任务板是空的。通常由统筹拆需求、建任务；你也可以直接在这里建。</p>
      ) : null}
      {(["active", "planned", "done"] as const).map((status) => columns[status].length ? (
        <section className="room-board__column" key={status}>
          <h3>{STATUS_LABEL[status]} <span>{columns[status].length}</span></h3>
          {columns[status].map((task) => <TaskCard key={task.id} room={room} rooms={rooms} task={task} />)}
        </section>
      ) : null)}
      {archived ? <p className="room-board__archived">已归档 {archived} 条</p> : null}
    </aside>
  );
}

function TaskCard({ room, rooms, task }: { room: Room; rooms: RoomsState; task: RoomTask }) {
  const [open, setOpen] = useState(false);
  const blockers = openBlockers(room, task);
  const run = (op: Parameters<typeof api.roomTask>[1]) => void rooms.run(() => api.roomTask(room.id, op));
  const assignees = [
    { value: "", label: "没人负责", disabled: true },
    ...activeMembers(room).map((member) => ({ value: member.title, label: member.title, description: member.duty || undefined })),
  ];
  const assignee = task.assignee ? room.members.find((member) => member.id === task.assignee)?.title ?? "" : "";
  return (
    <article className={`room-task room-task--${task.status}`}>
      <button aria-expanded={open} className="room-task__main" onClick={() => setOpen((value) => !value)} type="button">
        <span className="room-task__id">{task.id}</span>
        <span className="room-task__title">{task.title}</span>
        <span className="room-task__meta">
          {task.assignee ? labelOf(room, task.assignee) : "没人负责"}
          {blockers.length ? ` · 等 ${blockers.join("、")}` : ""}
        </span>
      </button>
      {open ? (
        <div className="room-task__detail">
          {task.outcome ? <p><b>完成标准</b>{task.outcome}</p> : null}
          {task.result ? <p><b>结果</b>{task.result}</p> : null}
          {task.notes ? <pre className="room-task__notes">{task.notes}</pre> : null}
          <p className="room-task__by">由 {labelOf(room, task.createdBy)} 创建 · {formatTime(task.createdAt)}</p>
          {task.status !== "done" && task.status !== "archived" ? (
            <label className="room-field room-field--inline"><span>负责人</span>
              <Select ariaLabel="负责人" onChange={(value) => { if (value) run({ op: "assign", task: task.id, assignee: value }); }}
                options={assignees} value={assignee} />
            </label>
          ) : null}
          <div className="room-row-actions">
            {task.status === "planned" ? <button disabled={blockers.length > 0} onClick={() => run({ op: "start", task: task.id })} type="button">开工</button> : null}
            {task.status === "planned" || task.status === "active" ? <button onClick={() => run({ op: "done", task: task.id })} type="button">标记完成</button> : null}
            {task.status === "active" || task.status === "done" ? <button onClick={() => run({ op: "reopen", task: task.id })} type="button">退回待开工</button> : null}
            <button onClick={() => run({ op: "archive", task: task.id })} type="button">归档</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function TaskForm({ room, rooms, onDone }: { room: Room; rooms: RoomsState; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [outcome, setOutcome] = useState("");
  const [assignee, setAssignee] = useState("");
  const [after, setAfter] = useState<string[]>([]);
  const people = [{ value: "", label: "暂不指定" }, ...activeMembers(room).map((member) => ({ value: member.title, label: member.title }))];
  const open = room.tasks.filter((task) => task.status === "planned" || task.status === "active");
  const submit = async () => {
    if (!title.trim()) return;
    const created = await rooms.run(() => api.roomTask(room.id, { op: "add", title, outcome: outcome || null, assignee: assignee || null, after }));
    if (created) onDone();
  };
  return (
    <form className="room-task-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <input aria-label="任务标题" autoFocus className="room-input" maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="任务标题" value={title} />
      <textarea aria-label="完成标准" className="room-input" onChange={(event) => setOutcome(event.target.value)} placeholder="完成标准（选填）" rows={2} value={outcome} />
      <label className="room-field room-field--inline"><span>负责人</span>
        <Select ariaLabel="负责人" onChange={setAssignee} options={people} value={assignee} />
      </label>
      {open.length ? (
        <div className="room-field"><span>要等这些完成（选填）</span>
          <div className="room-checks">
            {open.map((task) => (
              <Checkbox checked={after.includes(task.id)} key={task.id}
                onChange={(checked) => setAfter((list) => checked ? [...list, task.id] : list.filter((id) => id !== task.id))}>
                {task.id} {excerpt(task.title, 16)}
              </Checkbox>
            ))}
          </div>
        </div>
      ) : null}
      <div className="room-row-actions">
        <button onClick={onDone} type="button">取消</button>
        <button className="room-primary" disabled={!title.trim() || rooms.busy} type="submit">建任务</button>
      </div>
    </form>
  );
}

// ---- 对话框 ----

function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialog(onClose);
  const content = (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div aria-label={label} aria-modal="true" className="modal room-dialog" ref={ref} role="dialog">{children}</div>
    </div>
  );
  return createPortal(content, document.body);
}

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

function NewRoomDialog(props: {
  agents: AgentAvailability[]; project: ProjectWorkspace; rooms: RoomsState; onClose: () => void;
  onLaunchMember?: RoomViewProps["onLaunchMember"]; onRenameAgent?: RoomViewProps["onRenameAgent"];
}) {
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
  return (
    <Modal label="新建房间" onClose={() => { if (!busy) props.onClose(); }}>
      <strong className="modal__title">新建房间</strong>
      <p className="modal__body">一间房对应一个需求。第一行的角色当统筹：负责拆需求、派活、跟进度；其他人各管自己的职责。</p>
      <label className="room-field"><span>房间名</span>
        <input autoFocus className="room-input" maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="比如：登录页改版" value={name} />
      </label>
      <label className="room-field"><span>需求目标</span>
        <textarea className="room-input" onChange={(event) => setObjective(event.target.value)} placeholder="要做成什么样？统筹会据此拆任务" rows={3} value={objective} />
      </label>
      {canLaunch ? (
        <div className="room-field"><span>班子（项目「{props.project.name}」里各开一条会话）</span>
          <div className="room-roster">
            {roster.map((row, index) => (
              <div className="room-roster__row" key={index}>
                <span className="room-roster__role">{index === 0 ? <><Crown aria-hidden="true" size={ICON.xs} /> 统筹</> : "成员"}</span>
                <input aria-label="角色名" aria-invalid={Boolean(rowErrors[index])} className="room-input" onChange={(event) => update(index, { title: event.target.value })}
                  title={rowErrors[index] ?? undefined} value={row.title} />
                <input aria-label="职责" className="room-input" onChange={(event) => update(index, { duty: event.target.value })} placeholder="职责" value={row.duty} />
                <Select ariaLabel="Agent" onChange={(kind) => update(index, { kind: kind as AgentKind })} options={kinds} value={row.kind} />
                <button aria-label="删掉这一行" className="room-icon-button" disabled={roster.length === 1}
                  onClick={() => setRoster((rows) => rows.filter((_, at) => at !== index))} type="button">
                  <X aria-hidden="true" size={ICON.xs} />
                </button>
              </div>
            ))}
            <button className="room-link" onClick={() => setRoster((rows) => [...rows, { title: "", duty: "", kind: rows[0]?.kind ?? "claude" }])} type="button">
              + 加一位成员
            </button>
          </div>
          {rowErrors.find(Boolean) ? <p className="room-dialog__error">{rowErrors.find(Boolean)}</p> : null}
        </div>
      ) : (
        <p className="room-dialog__notice">没有检测到可用的 Claude / Codex：先只建房间，成员之后在左栏添加。</p>
      )}
      {error ? <p className="room-dialog__error" role="alert">{error}</p> : null}
      <div className="modal__actions">
        <button disabled={busy} onClick={props.onClose} type="button">取消</button>
        <button className="modal__primary" disabled={busy || !name.trim() || (canLaunch && rowErrors.some(Boolean))} onClick={() => void submit()} type="button">
          {busy ? "正在拉起成员…" : "创建"}
        </button>
      </div>
    </Modal>
  );
}

function AddMemberDialog(props: {
  agents: AgentAvailability[]; room: Room; rooms: RoomsState; tabs: WorkspaceTab[]; onClose: () => void;
  onLaunchMember?: RoomViewProps["onLaunchMember"]; onRenameAgent?: RoomViewProps["onRenameAgent"];
}) {
  const { room } = props;
  const kinds = agentOptions(props.agents);
  const taken = new Set(props.rooms.rooms.flatMap((summary) => summary.memberTabIds));
  const existing = props.tabs.filter((tab) => isAgentKind(tab.kind) && tab.phase === "running" && !taken.has(tab.id));
  const sources = [
    ...(props.onLaunchMember ? kinds.map((kind) => ({ value: `new:${kind.value}`, label: `新开一条 ${kind.label} 会话` })) : []),
    ...existing.map((tab) => ({ value: `tab:${tab.id}`, label: `已有会话：${tab.agentName ?? tab.title}`, description: tab.project.rootPath })),
  ];
  const [source, setSource] = useState(sources[0]?.value ?? "");
  const [title, setTitle] = useState("");
  const [duty, setDuty] = useState("");
  const [foreman, setForeman] = useState(foremanOf(room) === null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = titleError(title, activeMembers(room).map((member) => member.title));
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
      if (!added) reason = "没加进去，看上方提示";
    }
    setBusy(false);
    void props.rooms.refresh();
    if (reason) setError(reason);
    else props.onClose();
  };
  return (
    <Modal label="添加成员" onClose={() => { if (!busy) props.onClose(); }}>
      <strong className="modal__title">添加成员</strong>
      <label className="room-field"><span>会话</span>
        <Select ariaLabel="会话" disabled={!sources.length} onChange={setSource} options={sources} placeholder="没有可用的会话" value={source} />
      </label>
      <label className="room-field"><span>角色名</span>
        <input aria-invalid={Boolean(title) && Boolean(invalid)} autoFocus className="room-input" maxLength={24}
          onChange={(event) => setTitle(event.target.value)} placeholder="比如：测试" value={title} />
      </label>
      {title && invalid ? <p className="room-dialog__error">{invalid}</p> : null}
      <label className="room-field"><span>职责</span>
        <input className="room-input" onChange={(event) => setDuty(event.target.value)} placeholder="他负责什么" value={duty} />
      </label>
      <Checkbox checked={foreman} onChange={setForeman}>
        当统筹{foremanOf(room) ? `（替换现在的「${foremanOf(room)?.title}」）` : "（房间里还没有统筹）"}
      </Checkbox>
      {error ? <p className="room-dialog__error" role="alert">{error}</p> : null}
      <div className="modal__actions">
        <button disabled={busy} onClick={props.onClose} type="button">取消</button>
        <button className="modal__primary" disabled={busy || Boolean(invalid) || !source} onClick={() => void submit()} type="button">
          {busy ? "正在添加…" : "添加"}
        </button>
      </div>
    </Modal>
  );
}
