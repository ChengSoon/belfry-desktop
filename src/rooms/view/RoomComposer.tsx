import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Check, CornerUpLeft, LoaderCircle, Paperclip, SendHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { pointInsideRect } from "../../terminal/fileDrop";
import { ICON } from "../../theme/sizing";
import { composingKey, suppressComposingEnter } from "../../utils/keyboard";
import { toAppFailure } from "../../workspace/errors";
import { clipboardRoomFiles } from "../attachmentApi";
import { MAX_ATTACHMENTS, messageExcerpt, transferFiles } from "../attachments";
import type { Room, RoomMember, RoomMessage, RoomTabView } from "../contracts";
import { MEMBER_PRESENCE_LABEL, memberName, memberPresence, mentionedMembers, quoteSnippet } from "../model";
import { useRoomAttachments } from "../useRoomAttachments";
import type { RoomsController } from "../useRooms";
import { RoomAttachmentCard } from "./RoomAttachments";

export function RoomComposer({ room, rooms, tabs, replyTarget, onCancelReply, onSent }: {
  room: Room;
  rooms: RoomsController;
  tabs: Map<string, RoomTabView>;
  replyTarget: RoomMessage | null;
  onCancelReply: () => void;
  onSent: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [checkingPaste, setCheckingPaste] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mention, setMention] = useState<{ at: number; query: string; index: number } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const sendingRef = useRef(false);
  const pasteCount = useRef(0);
  const attachments = useRoomAttachments(room.id);
  const latest = useRef({ add: attachments.add });
  latest.current = { add: attachments.add };
  const live = useMemo(() => room.members.filter((member) => member.leftAt === null), [room.members]);
  const mentioned = useMemo(() => mentionedMembers(draft, live), [draft, live]);
  const candidates = useMemo(() => mention ? live.filter((member) => member.role.startsWith(mention.query)) : [], [live, mention]);
  const busy = sending || attachments.pending || checkingPaste;

  useEffect(() => {
    mounted.current = true;
    const stop = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (!mounted.current) return;
      if (payload.type === "leave") { setDragging(false); return; }
      const bounds = host.current?.getBoundingClientRect();
      const inside = !!bounds?.width && pointInsideRect(payload.position.toLogical(window.devicePixelRatio), bounds)
        && !document.querySelector('[aria-modal="true"]') && !sendingRef.current;
      setDragging(inside && payload.type !== "drop");
      if (inside && payload.type === "drop") void latest.current.add(payload.paths);
    }).catch(() => () => {});
    return () => { mounted.current = false; void stop.then((unlisten) => unlisten()); };
  }, []);

  useEffect(() => {
    const ids = new Set(live.map((member) => member.id));
    setRecipients((current) => current.some((id) => !ids.has(id)) ? current.filter((id) => ids.has(id)) : current);
  }, [live]);

  const submit = async () => {
    const text = draft.trim();
    if ((!text && attachments.items.length === 0) || sendingRef.current || pasteCount.current > 0) return;
    const attachmentIds = attachments.beginSend();
    if (attachmentIds === null) return;
    sendingRef.current = true;
    setSending(true);
    let ok = false;
    try {
      ok = recipients.length > 0
        ? await rooms.dispatch(text, recipients, undefined, attachmentIds)
        : live.length > 0
          ? await rooms.broadcast(text, replyTarget?.id, attachmentIds)
          : await rooms.sendMessage(text, replyTarget?.id, attachmentIds);
    } finally {
      attachments.finishSend(ok);
      sendingRef.current = false;
      if (mounted.current) setSending(false);
    }
    if (ok && mounted.current) {
      setDraft(""); setRecipients([]); setMention(null);
      onSent();
      requestAnimationFrame(() => composer.current?.focus());
    }
  };

  const change = (value: string, caret: number) => {
    setDraft(value);
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");
    const query = at >= 0 ? before.slice(at + 1) : "";
    const open = at >= 0 && !/[\n@]/.test(query) && live.length > 0
      && (query === "" || live.some((member) => member.role.startsWith(query)));
    setMention((current) => open ? { at, query, index: current?.query === query ? current.index : 0 } : null);
  };

  const chooseMention = (member: RoomMember) => {
    if (!mention) return;
    const caret = composer.current?.selectionStart ?? draft.length;
    const value = draft.slice(0, mention.at) + `@${member.role} ` + draft.slice(caret);
    const position = mention.at + member.role.length + 2;
    setDraft(value); setMention(null);
    requestAnimationFrame(() => { composer.current?.focus(); composer.current?.setSelectionRange(position, position); });
  };

  const composerKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (composingKey(event.nativeEvent)) {
      if (suppressComposingEnter(event.nativeEvent)) event.preventDefault();
      return;
    }
    if (mention && candidates.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setMention((current) => current ? { ...current, index: (current.index + step + candidates.length) % candidates.length } : current);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault(); chooseMention(candidates[Math.min(mention.index, candidates.length - 1)]); return;
      }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMention(null); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
  };

  const paste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = transferFiles(event.clipboardData);
    const text = event.clipboardData.getData("text/plain");
    event.preventDefault();
    if (sendingRef.current) return;
    const input = event.currentTarget;
    const snapshot = { value: input.value, start: input.selectionStart, end: input.selectionEnd };
    const insertText = () => {
      if (!mounted.current || !text) return;
      // 异步读取剪贴板期间若继续打字，保留新内容，在当前光标处插入。
      const unchanged = input.value === snapshot.value;
      const start = unchanged ? snapshot.start : input.selectionStart;
      const end = unchanged ? snapshot.end : input.selectionEnd;
      const value = input.value.slice(0, start) + text + input.value.slice(end);
      const caret = start + text.length;
      change(value, caret);
      requestAnimationFrame(() => { if (mounted.current) input.setSelectionRange(caret, caret); });
    };
    if (files.length) {
      insertText();
      void attachments.add(files);
      return;
    }
    pasteCount.current += 1; setCheckingPaste(true);
    try {
      const paths = await clipboardRoomFiles();
      if (!mounted.current) return;
      if (paths.length) await attachments.add(paths);
      else insertText();
    } catch (cause) {
      // 原生文件列表不可用时，普通文本照样能粘贴。
      insertText();
      if (mounted.current && !text) attachments.reportError(toAppFailure(cause).message);
    } finally {
      pasteCount.current -= 1;
      if (mounted.current) setCheckingPaste(pasteCount.current > 0);
    }
  };

  const sendLabel = recipients.length > 0 ? `派发（${recipients.length}）`
    : mentioned.length > 0 ? `发给 ${mentioned.map((member) => member.role).join("、")}`
      : live.length > 0 ? `发到群聊（${live.length}）` : "记录";

  return <div className={`room-composer${dragging ? " room-composer--dragging" : ""}`} ref={host}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = sending ? "none" : "copy"; setDragging(!sending); } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={(event) => {
      const files = transferFiles(event.dataTransfer);
      setDragging(false);
      if (files.length) { event.preventDefault(); void attachments.add(files); }
    }}>
    {replyTarget ? <div className="room-reply-banner">
      <CornerUpLeft aria-hidden="true" size={ICON.xs} />
      <span>正在回复 {replyTarget.kind === "member" ? memberName(room, replyTarget.author) : "我"}：{quoteSnippet(messageExcerpt(replyTarget))}</span>
      <button aria-label="取消回复" disabled={sending} onClick={onCancelReply} title="取消回复" type="button"><X aria-hidden="true" size={ICON.xs} /></button>
    </div> : null}
    <div className="room-composer__recipients">
      {live.length === 0 ? <span className="room-composer__hintline">房间还没有成员，这条只会记进讨论。</span>
        : live.map((member) => {
          const presence = memberPresence(tabs.get(member.tabId));
          const selected = recipients.includes(member.id);
          return <button aria-pressed={selected} className="room-recipient" disabled={presence !== "online" || sending}
            key={member.id} onClick={() => setRecipients((current) => selected ? current.filter((id) => id !== member.id) : [...current, member.id])}
            title={presence === "online" ? `发给 ${member.role}` : `${member.role}${MEMBER_PRESENCE_LABEL[presence]}，等它空闲再派`} type="button">
            {selected ? <Check aria-hidden="true" size={ICON.xs} /> : null}{member.role}
          </button>;
        })}
    </div>
    {mention && candidates.length > 0 ? <div aria-label="点名成员" className="room-mention" role="listbox">
      {candidates.map((member, index) => <button aria-selected={index === Math.min(mention.index, candidates.length - 1)} key={member.id}
        onClick={() => chooseMention(member)} onMouseDown={(event) => event.preventDefault()} role="option" type="button">
        <strong>@{member.role}</strong><small>{MEMBER_PRESENCE_LABEL[memberPresence(tabs.get(member.tabId))]}</small>
      </button>)}
    </div> : null}
    <div className="room-composer__box">
      <textarea aria-label="房间消息" disabled={sending} onChange={(event) => change(event.target.value, event.target.selectionStart)}
        onKeyDown={composerKey} onPaste={(event) => void paste(event)} placeholder="写消息，或粘贴图片和文档…" ref={composer} rows={3} value={draft} />
      {attachments.items.length ? <div aria-label="待发送附件" aria-live="polite" className="room-attachments room-attachments--draft">
        {attachments.items.map((item) => <RoomAttachmentCard attachment={item.attachment} disabled={sending} key={item.key}
          name={item.name} onRemove={() => attachments.remove(item.key)} roomId={room.id} size={item.size} />)}
      </div> : null}
      <div className="room-composer__toolbar">
        <div className="room-composer__tools">
          <button aria-label="添加图片或文档" className="room-attach" disabled={sending || attachments.items.length >= MAX_ATTACHMENTS}
            onClick={() => void attachments.pick()} title="选择文件；支持粘贴和拖入。每条最多 10 个，单个不超过 20 MB" type="button">
            <Paperclip aria-hidden="true" size={ICON.sm} /><span>添加附件</span>
          </button>
          <span className="room-composer__upload-hint">{attachments.items.length ? `${attachments.items.length} / ${MAX_ATTACHMENTS} 个附件` : "图片、PDF、Word 等 · 单个 ≤ 20 MB"}</span>
        </div>
        <button className="room-send" disabled={(!draft.trim() && attachments.items.length === 0) || busy}
          onClick={() => void submit()} title={recipients.length > 0 ? "派发任务" : mentioned.length > 0 ? `只发给被点名的人：${mentioned.map((member) => member.role).join("、")}` : live.length > 0 ? "发到群聊（不派活）" : "记进讨论"} type="button">
          {sending ? <LoaderCircle aria-hidden="true" className="room-send__spin" size={ICON.sm} /> : <SendHorizontal aria-hidden="true" size={ICON.sm} />}
          <span>{sendLabel}</span>
        </button>
      </div>
      {dragging ? <div className="room-composer__drop"><Paperclip aria-hidden="true" size={ICON.lg} /><strong>松开添加图片或文档</strong><span>每条最多 10 个 · 单个不超过 20 MB</span></div> : null}
    </div>
    {attachments.error ? <div className="room-composer__error" role="alert"><span>{attachments.error}</span>
      <button aria-label="关闭附件提示" onClick={attachments.clearError} type="button"><X aria-hidden="true" size={ICON.xs} /></button>
    </div> : null}
    <p className="room-composer__note"><span>直接发送＝群聊；@ 点名接话，选中成员派任务</span><span>Enter 发送 · Shift+Enter 换行</span></p>
  </div>;
}
