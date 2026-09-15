import type { HistorySession } from "../contracts";
import type { SessionMetadata } from "../metadata";
import type { HistorySearchHit } from "../search";
import { highlightedParts } from "../search";
import { useState } from "react";
import { Play, Star, Tags, Trash2 } from "lucide-react";
import { ICON } from "../../theme/sizing";
import { agentLabel, formatMoment, formatRelative } from "../../usage/format";
import { HistoryTagEditor } from "./HistoryTagEditor";
import { Checkbox } from "../../components/controls/Checkbox";

interface Props {
  hit: HistorySearchHit;
  query: string;
  metadata: SessionMetadata;
  selected: boolean;
  selecting: boolean;
  busy: boolean;
  onResume: (session: HistorySession) => void;
  onInspect: (session: HistorySession) => void;
  onDelete: (session: HistorySession) => void;
  onSelect: (session: HistorySession) => void;
  onFavorite: (session: HistorySession) => void;
  onTags: (session: HistorySession, tags: string[]) => boolean | void;
  onTagFilter: (tag: string) => void;
}

export function HistoryRow(props: Props) {
  const [editing, setEditing] = useState(false);
  const { session, snippet } = props.hit;
  return <li className={`history-result${props.selected ? " is-selected" : ""}`}>
    <div className={`history-item${props.selected ? " is-selected" : ""}`}>
      {props.selecting ? <Checkbox className="history-item__check" checked={props.selected}
        ariaLabel={`选择 ${session.title || "无标题会话"}`} onChange={() => props.onSelect(session)} /> : null}
      <button className="history-item__main" type="button" onClick={() => {
        if (props.selecting) props.onSelect(session); else props.onInspect(session);
      }} title={`查看会话详情 · ${formatMoment(session.lastActiveAt) ?? "未知时间"}`}>
        <span className="history-item__title"><Highlighted text={session.title || "无标题会话"} query={props.query} /></span>
        <span className="history-item__meta" title={session.cwd ?? "未知目录"}>
          {agentLabel(session.agent)} · {session.cwd ?? "未知目录"}
        </span>
        {snippet ? <span className="history-item__snippet"><Highlighted text={snippet} query={props.query} /></span> : null}
        <span className="history-item__meta">{formatRelative(session.lastActiveAt) ?? "未知时间"}</span>
      </button>
      <RowActions props={props} onEdit={() => setEditing(!editing)} />
    </div>
    {props.metadata.tags.length ? <div className="history-item__tags">
      {props.metadata.tags.map((tag) => <button key={tag} type="button" title={`筛选标签：${tag}`}
        onClick={() => props.onTagFilter(tag)}>{tag}</button>)}
    </div> : null}
    {editing ? <HistoryTagEditor tags={props.metadata.tags} onClose={() => setEditing(false)}
      onSave={(tags) => props.onTags(session, tags)} /> : null}
  </li>;
}

function RowActions({ props, onEdit }: { props: Props; onEdit: () => void }) {
  const { session } = props.hit;
  return <div className="history-item__actions history-item__actions--grid">
    <button className={`icon-button icon-button--sm${props.metadata.favorite ? " history-favorite" : ""}`}
      aria-label={props.metadata.favorite ? "取消收藏" : "收藏会话"} aria-pressed={props.metadata.favorite}
      title={props.metadata.favorite ? "取消收藏" : "收藏会话"} type="button" onClick={() => props.onFavorite(session)}>
      <Star size={ICON.sm} aria-hidden="true" fill={props.metadata.favorite ? "currentColor" : "none"} />
    </button>
    <button className="icon-button icon-button--sm" type="button" aria-label="编辑标签" title="编辑标签" onClick={onEdit}>
      <Tags size={ICON.sm} aria-hidden="true" />
    </button>
    <button className="icon-button icon-button--sm" type="button" aria-label="继续会话" title="继续会话"
      onClick={() => props.onResume(session)}><Play size={ICON.sm} aria-hidden="true" /></button>
    <button className="icon-button icon-button--sm history-item__delete" type="button" aria-label="删除会话" title="删除会话"
      disabled={props.busy} onClick={() => props.onDelete(session)}><Trash2 size={ICON.sm} aria-hidden="true" /></button>
  </div>;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return <>{highlightedParts(text, query).map((part, index) => part.match
    ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</>;
}
