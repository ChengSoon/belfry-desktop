import { t, useTranslation } from "../../i18n";
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
  useTranslation();
  const [editing, setEditing] = useState(false);
  const { session, snippet } = props.hit;
  return <li className={`history-result${props.selected ? " is-selected" : ""}`}>
    <div className={`history-item${props.selected ? " is-selected" : ""}`}>
      {props.selecting ? <Checkbox className="history-item__check" checked={props.selected}
        ariaLabel={t("history.HistoryRow.text_c1c5215fc9", { title: session.title || t("history.HistoryRow.text_8af5d7ce46") })} onChange={() => props.onSelect(session)} /> : null}
      <button className="history-item__main" type="button" onClick={() => {
        if (props.selecting) props.onSelect(session); else props.onInspect(session);
      }} title={t("history.HistoryRow.text_822ad8b362", { title: formatMoment(session.lastActiveAt) ?? t("history.HistoryRow.text_65c9b80829") })}>
        <span className="history-item__title"><Highlighted text={session.title || t("history.HistoryRow.text_8af5d7ce46")} query={props.query} /></span>
        <span className="history-item__meta" title={session.cwd ?? t("history.HistoryRow.text_e89982ec33")}>
          {agentLabel(session.agent)} · {session.cwd ?? t("history.HistoryRow.text_e89982ec33")}
        </span>
        {snippet ? <span className="history-item__snippet"><Highlighted text={snippet} query={props.query} /></span> : null}
        <span className="history-item__meta">{formatRelative(session.lastActiveAt) ?? t("history.HistoryRow.text_65c9b80829")}</span>
      </button>
      <RowActions props={props} onEdit={() => setEditing(!editing)} />
    </div>
    {props.metadata.tags.length ? <div className="history-item__tags">
      {props.metadata.tags.map((tag) => <button key={tag} type="button" title={t("history.HistoryRow.text_fe4b2324a4", { tag: tag })}
        onClick={() => props.onTagFilter(tag)}>{tag}</button>)}
    </div> : null}
    {editing ? <HistoryTagEditor tags={props.metadata.tags} onClose={() => setEditing(false)}
      onSave={(tags) => props.onTags(session, tags)} /> : null}
  </li>;
}

function RowActions({ props, onEdit }: { props: Props; onEdit: () => void }) {
  useTranslation();
  const { session } = props.hit;
  return <div className="history-item__actions history-item__actions--grid">
    <button className={`icon-button icon-button--sm${props.metadata.favorite ? " history-favorite" : ""}`}
      aria-label={props.metadata.favorite ? t("history.HistoryRow.text_dca60869e7") : t("history.HistoryRow.text_f3dead9780")} aria-pressed={props.metadata.favorite}
      title={props.metadata.favorite ? t("history.HistoryRow.text_dca60869e7") : t("history.HistoryRow.text_f3dead9780")} type="button" onClick={() => props.onFavorite(session)}>
      <Star size={ICON.sm} aria-hidden="true" fill={props.metadata.favorite ? "currentColor" : "none"} />
    </button>
    <button className="icon-button icon-button--sm" type="button" aria-label={t("history.HistoryRow.text_cdcd9666ff")} title={t("history.HistoryRow.text_cdcd9666ff")} onClick={onEdit}>
      <Tags size={ICON.sm} aria-hidden="true" />
    </button>
    <button className="icon-button icon-button--sm" type="button" aria-label={t("history.HistoryRow.text_a2ba41e9da")} title={t("history.HistoryRow.text_a2ba41e9da")}
      onClick={() => props.onResume(session)}><Play size={ICON.sm} aria-hidden="true" /></button>
    <button className="icon-button icon-button--sm history-item__delete" type="button" aria-label={t("history.HistoryRow.text_d51250d14a")} title={t("history.HistoryRow.text_d51250d14a")}
      disabled={props.busy} onClick={() => props.onDelete(session)}><Trash2 size={ICON.sm} aria-hidden="true" /></button>
  </div>;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  useTranslation();
  return <>{highlightedParts(text, query).map((part, index) => part.match
    ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</>;
}
