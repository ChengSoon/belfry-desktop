import { useSyncExternalStore } from "react";
import type { RoomAttachment, RoomMessage } from "./contracts";

export interface DraftAttachment {
  key: string;
  sourceKey: string;
  name: string;
  size?: number;
  attachment: RoomAttachment | null;
}

interface DraftForm { text: string; to: string; ask: boolean; replyTo: RoomMessage | null }
export interface RoomDraft extends DraftForm {
  items: DraftAttachment[];
  error: string | null;
  picking: boolean;
  sending: boolean;
}
const fields = ["text", "to", "ask", "replyTo"] as const;
type Revisions = Record<keyof DraftForm, number>;
export interface RoomSubmission extends DraftForm {
  attachmentIds: string[];
  keys: Set<string>;
  revisions: Revisions;
}

/** Drafts live for the application session, independently of room/panel component lifetimes. */
class RoomDraftStore {
  private state: RoomDraft = { text: "", to: "", ask: true, replyTo: null, items: [], error: null, picking: false, sending: false };
  private listeners = new Set<() => void>();
  private revisions: Revisions = { text: 0, to: 0, ask: 0, replyTo: 0 };
  private submission: RoomSubmission | null = null;
  disposed = false;

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  update = (patch: Partial<RoomDraft>) => {
    if (this.disposed) return;
    for (const field of fields) {
      if (field in patch && patch[field] !== this.state[field]) this.revisions[field]++;
    }
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  };
  beginSend = (): RoomSubmission | null => {
    const { sending, picking, items, text, to, ask, replyTo } = this.state;
    if (this.disposed || sending || picking || items.some((item) => !item.attachment)) return null;
    this.submission = { text, to, ask, replyTo, attachmentIds: items.map((item) => item.attachment!.id),
      keys: new Set(items.map((item) => item.key)), revisions: { ...this.revisions } };
    this.update({ sending: true });
    return this.submission;
  };
  isSubmitted = (key: string) => this.submission?.keys.has(key) ?? false;
  finishSend = (submission: RoomSubmission, success: boolean) => {
    if (this.submission !== submission) return;
    this.submission = null;
    const patch: Partial<RoomDraft> = { sending: false };
    if (success) {
      patch.items = this.state.items.filter((item) => !submission.keys.has(item.key));
      patch.error = null;
      // Each field has its own edit lifetime; a send completion only clears its unchanged snapshot.
      if (this.revisions.text === submission.revisions.text) patch.text = "";
      if (this.revisions.ask === submission.revisions.ask) patch.ask = true;
      if (this.revisions.replyTo === submission.revisions.replyTo) patch.replyTo = null;
    }
    this.update(patch);
  };
}

const drafts = new Map<string, RoomDraftStore>();
export function roomDraft(roomId: string) {
  let store = drafts.get(roomId);
  if (!store) { store = new RoomDraftStore(); drafts.set(roomId, store); }
  return store;
}
export function forgetRoomDraft(roomId: string) {
  const store = drafts.get(roomId);
  if (store) store.disposed = true;
  drafts.delete(roomId);
}
export function useRoomDraft(roomId: string) {
  const store = roomDraft(roomId);
  const draft = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { draft, store };
}
