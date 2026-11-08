import { TranslationError, errorMessage, formatNumber, t } from "../i18n";
import type { Room, RoomAttachment, RoomMessage } from "./contracts";
import { roomHistory, type RoomHistoryPage, type RoomHistoryRecord } from "./history-api";

export interface HistorySnapshot {
  entries: RoomHistoryRecord[]; nextCursor: string | null; started: boolean;
  loading: boolean; exhausted: boolean; error: string | null;
}
export class RoomHistoryPager {
  private state: HistorySnapshot = { entries: [], nextCursor: null, started: false, loading: false, exhausted: false, error: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  constructor(readonly roomId: string, private fetch: (id: string, cursor: string | null, limit: number) => Promise<RoomHistoryPage> = roomHistory) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<HistorySnapshot>) {
    this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener());
  }
  cancel() { this.generation++; if (this.state.loading) this.publish({ loading: false }); }
  async loadEarlier(visibleIds: ReadonlySet<string>, before: number, beforeCommit?: () => void) {
    if (this.state.loading || this.state.exhausted) return;
    const request = ++this.generation;
    let entries = this.state.entries, nextCursor = this.state.nextCursor;
    const visited = new Set<string>();
    this.publish({ loading: true, started: true, error: null });
    try {
      // The first server page overlaps the live window. Walk opaque cursors until
      // older content is found; never derive an offset from a message timestamp.
      while (true) {
        const page = await this.fetch(this.roomId, nextCursor, 200);
        if (request !== this.generation) return;
        if (page.nextCursor !== null && (page.nextCursor === nextCursor || visited.has(page.nextCursor))) throw new TranslationError("rooms.history.cursorStalled");
        if (page.nextCursor) visited.add(page.nextCursor);
        const existing = new Map(entries.map(entry => [entry.offset, entry]));
        const seen = new Set<string>();
        entries = [...page.entries, ...entries].filter(entry => !seen.has(entry.offset) && !!seen.add(entry.offset)).map(entry => existing.get(entry.offset) ?? entry);
        nextCursor = page.nextCursor;
        const older = page.entries.some(entry => !entry.event || (!visibleIds.has(entry.event.id) && entry.event.ts < before));
        if (nextCursor === null || older) break;
      }
      beforeCommit?.();
      this.publish({ entries, nextCursor, loading: false, exhausted: nextCursor === null });
    } catch (error) {
      if (request !== this.generation) return;
      beforeCommit?.();
      this.publish({ entries, nextCursor, loading: false, error: errorMessage(error) });
    }
  }
}

function recordData(record: RoomHistoryRecord): Record<string, unknown> | null {
  const value = record.event?.data;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function attachment(value: unknown): value is RoomAttachment {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RoomAttachment>;
  return typeof item.id === "string" && typeof item.name === "string" && typeof item.path === "string"
    && typeof item.mimeType === "string" && typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0;
}
export function historyMessage(record: RoomHistoryRecord, roomId: string): RoomMessage | null {
  const event = record.event, data = recordData(record);
  if (record.truncated || !event || event.v !== 1 || event.room_id !== roomId || !["chat.message", "system.notify"].includes(event.kind)
    || !data || typeof data.text !== "string" || !Array.isArray(data.to) || !data.to.every(id => typeof id === "string")
    || !Number.isFinite(event.ts)) return null;
  return { id: event.id, at: event.ts, by: event.by, kind: event.kind === "system.notify" ? "notice" : "chat",
    text: data.text, to: data.to as string[], mode: data.message_mode === "request_reply" ? "request_reply" : "send",
    replyTo: typeof data.reply_to === "string" ? data.reply_to : null,
    attachments: Array.isArray(data.attachments) ? data.attachments.filter(attachment) : [],
    deliveredTo: [], repliedBy: [], replyCancelled: false };
}
export type HistoryTimelineItem =
  | { key: string; at: number; kind: "message"; message: RoomMessage; historical: boolean; record?: RoomHistoryRecord }
  | { key: string; at: number; kind: "event"; record: RoomHistoryRecord };

/** Projected messages win over old ledger payloads; history never invents current reply state. */
export function historyTimeline(entries: readonly RoomHistoryRecord[], observed: readonly RoomMessage[], room: Room): HistoryTimelineItem[] {
  const current = new Map([...(room.retainedMessages ?? []), ...room.messages].map(message => [message.id, message]));
  const items = new Map<string, HistoryTimelineItem>();
  for (const record of entries) {
    const message = historyMessage(record, room.id);
    if (message) {
      const projected = current.get(message.id);
      items.set(`message:${message.id}`, { key: `message:${message.id}`, at: message.at, kind: "message", message: projected ?? message, historical: !projected, record });
    } else {
      items.set(`event:${record.offset}`, { key: `event:${record.offset}`, at: record.event?.ts ?? 0, kind: "event", record });
    }
  }
  for (const message of [...observed, ...room.messages]) {
    const projected = current.get(message.id), key = `message:${message.id}`;
    const previous = items.get(key);
    items.set(key, { key, at: message.at, kind: "message", message: projected ?? message, historical: !projected, record: previous?.record });
  }
  return [...items.values()].sort((a, b) => a.at - b.at);
}
export function historySize(bytes: number | undefined) {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return t("rooms.history.sizeUnknown");
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${formatNumber(value, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}
