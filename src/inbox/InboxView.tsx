import { AlertTriangle, ArrowLeft, Paperclip, Reply, Search, SquareTerminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime, formatNumber, t, useTranslation } from "../i18n";
import { ICON } from "../theme/sizing";
import type { MessageView, SessionView } from "./contracts";
import { messageStatus, needsAttention, questionState, statusText, statusTone } from "./status";
import type { InboxView as InboxData } from "./useInbox";
import "./inbox.css";

interface InboxViewProps {
  inbox: InboxData;
  /** 切到目标会话的终端。会话不在时不提供。 */
  onOpenSession?: (tabId: string) => void;
  availableTabIds?: readonly string[];
}

/**
 * 只读收件箱：会话列表 → 消息详情。没有投递、合并、撤回、答复等操作；这些由 Agent 与后台完成。
 * 面板宽度有限，列表与详情是两级页面，Esc 或“会话”返回列表。
 */
export function InboxView({ inbox, onOpenSession, availableTabIds }: InboxViewProps) {
  useTranslation();
  const [filter, setFilter] = useState<"all" | "active">("all");
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const reading = inbox.selected !== null;

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return inbox.sessions.filter((session) => (filter === "all" || needsAttention(session))
      && (!q || `${session.name} ${session.agent} ${session.tabId} ${session.lastMessagePreview ?? ""}`.toLocaleLowerCase().includes(q)));
  }, [inbox.sessions, filter, query]);
  const activeCount = inbox.sessions.filter(needsAttention).length;
  const session = inbox.sessions.find((item) => item.sessionKey === inbox.selected) ?? null;

  useEffect(() => {
    if (!reading) return;
    backRef.current?.focus({ preventScroll: true });
    // 捕获阶段先处理：详情里的 Esc 只返回列表，不让外层面板的 dismiss 把整个面板关掉。
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [reading]);

  const close = () => {
    const key = inbox.selected;
    inbox.select(null);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-session="${CSS.escape(key ?? "")}"]`)?.focus());
  };

  if (reading) {
    const canOpen = session && onOpenSession && (!availableTabIds || availableTabIds.includes(session.tabId));
    return (
      <section className="inbox inbox--detail" aria-label={session?.name ?? t("inbox.panel.title")}>
        <header className="inbox-detail__head">
          <button ref={backRef} className="inbox-back" type="button" onClick={close}>
            <ArrowLeft aria-hidden="true" size={ICON.sm} />{t("inbox.panel.back")}
          </button>
          {session ? <SessionHeader session={session} /> : null}
          {session ? (
            <button className="collab-button inbox-open" type="button" disabled={!canOpen} title={canOpen ? undefined : t("inbox.panel.targetGone")}
              onClick={() => canOpen && onOpenSession!(session.tabId)}>
              <SquareTerminal aria-hidden="true" size={ICON.sm} />{t("inbox.panel.openSession")}
            </button>
          ) : null}
        </header>
        {inbox.messagesError ? <ErrorLine message={inbox.messagesError} onRetry={inbox.refresh} /> : null}
        <MessageList inbox={inbox} />
      </section>
    );
  }

  return (
    <section className="inbox" aria-label={t("inbox.panel.title")}>
      <div className="inbox-tools">
        <label className="inbox-search">
          <Search aria-hidden="true" size={ICON.sm} />
          <input type="search" value={query} placeholder={t("inbox.panel.search")} aria-label={t("inbox.panel.search")}
            onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
        </label>
        <div className="collab-filters" role="group" aria-label={t("inbox.panel.filters")}>
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("inbox.panel.all")}<span>{formatNumber(inbox.sessions.length)}</span></button>
          <button type="button" aria-pressed={filter === "active"} onClick={() => setFilter("active")}>{t("inbox.panel.active")}<span>{formatNumber(activeCount)}</span></button>
        </div>
      </div>
      {inbox.error ? <ErrorLine message={inbox.error} onRetry={inbox.refresh} /> : null}
      <div className="inbox-list" ref={listRef}>
        {visible.map((item) => <SessionRow key={item.sessionKey} session={item} onOpen={() => inbox.select(item.sessionKey)} />)}
        {inbox.loaded && visible.length === 0 ? (
          <p className="inbox-empty" role="status">
            {query.trim() ? t("inbox.panel.emptySearch") : filter === "active" && inbox.sessions.length ? t("inbox.panel.emptyFilter") : t("inbox.panel.empty")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ErrorLine({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  useTranslation();
  return (
    <div className="collab-panel__error" role="alert">
      <AlertTriangle aria-hidden="true" size={ICON.sm} />
      <div><span>{message}</span><small>{t("inbox.panel.loadError")}</small>
        <button className="collab-button" type="button" onClick={() => void onRetry()}>{t("inbox.panel.retry")}</button></div>
    </div>
  );
}

function counts(session: SessionView) {
  return [
    session.pendingCount > 0 ? t("inbox.panel.pendingCount", { count: session.pendingCount }) : null,
    session.awaitingReplyCount > 0 ? t("inbox.panel.awaitingCount", { count: session.awaitingReplyCount }) : null,
  ].filter(Boolean).join(" · ");
}

function SessionRow({ session, onOpen }: { session: SessionView; onOpen: () => void }) {
  useTranslation();
  const tone = statusTone(session.summaryStatus);
  const summary = counts(session);
  return (
    <button className="inbox-session" type="button" data-session={session.sessionKey} onClick={onOpen}>
      <span className="inbox-avatar" aria-hidden="true">{initial(session.name)}</span>
      <span className="inbox-session__body">
        <span className="inbox-session__top">
          <strong>{session.name}</strong>
          <span className="inbox-agent" title={session.tabId}>{session.agent} · {shortTab(session.tabId)}</span>
          {session.lastMessageAt ? <time dateTime={new Date(session.lastMessageAt).toISOString()}>{formatDateTime(session.lastMessageAt, { hour: "2-digit", minute: "2-digit" })}</time> : null}
        </span>
        <span className={`inbox-status inbox-status--${tone}`}><i aria-hidden="true" />{statusText(session.summaryStatus)}</span>
        {session.lastMessagePreview ? <span className="inbox-session__preview">{session.lastMessagePreview}</span> : null}
        {summary ? <span className="inbox-session__counts">{summary}</span> : null}
      </span>
    </button>
  );
}

function SessionHeader({ session }: { session: SessionView }) {
  useTranslation();
  const summary = counts(session);
  const availability = ["ready", "busy", "needs_input", "offline", "unavailable"].includes(session.runtimeAvailability)
    ? t(`inbox.availability.${session.runtimeAvailability}`) : session.runtimeAvailability;
  return (
    <div className="inbox-who">
      <h3>{session.name}</h3>
      <p>{t("inbox.panel.sessionMeta", { agent: session.agent, tab: shortTab(session.tabId), availability })}</p>
      <p className={`inbox-status inbox-status--${statusTone(session.summaryStatus)}`}>
        <i aria-hidden="true" /><strong>{statusText(session.summaryStatus)}</strong>{summary ? <span>{summary}</span> : null}
      </p>
    </div>
  );
}

function MessageList({ inbox }: { inbox: InboxData }) {
  useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastCount = useRef(0);
  const anchor = useRef<{ id: string; top: number } | null>(null);

  // 新消息到达时贴底；加载更早消息时保持阅读位置不跳。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (anchor.current) {
      const node = el.querySelector<HTMLElement>(`[data-entry="${CSS.escape(anchor.current.id)}"]`);
      if (node) el.scrollTop += node.offsetTop - anchor.current.top;
      anchor.current = null;
    } else if (stick.current || lastCount.current === 0) {
      el.scrollTop = el.scrollHeight;
    }
    lastCount.current = inbox.messages.length;
  }, [inbox.messages]);

  const loadOlder = () => {
    const el = ref.current, first = inbox.messages[0];
    if (el && first) {
      const node = el.querySelector<HTMLElement>(`[data-entry="${CSS.escape(first.id)}"]`);
      if (node) anchor.current = { id: first.id, top: node.offsetTop };
    }
    void inbox.loadOlder();
  };
  const byMessageId = useMemo(() => new Map(inbox.messages.map((m) => [m.messageId, m])), [inbox.messages]);

  return (
    <div className="inbox-messages" ref={ref} onScroll={(event) => {
      const el = event.currentTarget;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    }}>
      {inbox.hasOlder ? (
        <button className="collab-button inbox-older" type="button" disabled={inbox.loadingOlder} onClick={loadOlder}>{t("inbox.panel.loadOlder")}</button>
      ) : null}
      {inbox.messages.length === 0 && !inbox.messagesError ? <p className="inbox-empty">{t("inbox.panel.noMessages")}</p> : null}
      {inbox.messages.map((message) => <Message key={message.id} message={message} quoted={message.replyTo ? byMessageId.get(message.replyTo) : undefined} />)}
    </div>
  );
}

function Message({ message, quoted }: { message: MessageView; quoted?: MessageView }) {
  useTranslation();
  const original = quoted ?? message.replyPreview;
  const status = messageStatus(message);
  const tone = statusTone(status);
  const kind = message.class === "discussion" ? null : t(`inbox.class.${message.class}`);
  return (
    <article className={`inbox-message inbox-message--${message.deliveryPhase}`} data-entry={message.id}>
      <span className="inbox-avatar inbox-avatar--small" aria-hidden="true">{initial(message.by.name)}</span>
      <div className="inbox-message__body">
        <div className="inbox-message__meta">
          <strong>{message.by.name}</strong>
          {kind ? <span className={`inbox-kind inbox-kind--${message.class}`}>{kind}</span> : null}
          <time dateTime={new Date(message.createdAt).toISOString()}>{formatDateTime(message.createdAt, { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
        {original ? (
          <p className="inbox-quote"><Reply aria-hidden="true" size={12} />{t("inbox.panel.replyTo", { name: original.by.name, text: original.text })}</p>
        ) : null}
        <p className="inbox-message__text">{message.text}</p>
        {message.attachments.length ? (
          <p className="inbox-attachments"><Paperclip aria-hidden="true" size={12} />{t("inbox.panel.attachments", { count: message.attachments.length })}
            <span>{message.attachments.map((a) => a.name).join("、")}</span></p>
        ) : null}
        {message.questions.length ? (
          <ol className="inbox-questions">
            {message.questions.map((question, index) => {
              const state = questionState(question, message);
              const reply = message.replies.find((r) => question.replyMessageIds.includes(r.messageId));
              return (
                <li key={question.id} className={`inbox-question inbox-question--${state}`}>
                  <span className="inbox-question__index">{t("inbox.panel.question", { index: index + 1 })}</span>
                  <span className="inbox-question__text">{question.text}</span>
                  <span className="inbox-question__state">
                    {state === "replied" ? (reply ? t("inbox.panel.answered", { text: reply.text }) : t("inbox.panel.answeredNoText"))
                      : state === "cancelled" ? t("inbox.panel.cancelled") : state === "awaiting" ? t("inbox.panel.awaiting") : t("inbox.panel.notDelivered")}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
        <p className={`inbox-status inbox-status--${tone} inbox-message__status`}><i aria-hidden="true" />{statusText(status)}</p>
      </div>
    </article>
  );
}

function initial(name: string) { return [...name.trim()][0] ?? "?"; }
/** 长 tabId 取末 6 位：前缀常相同（agent-…），末尾才区分同类模型的不同会话。完整 id 放 title。 */
function shortTab(tabId: string) { return tabId.length > 8 ? `…${tabId.slice(-6)}` : tabId; }
