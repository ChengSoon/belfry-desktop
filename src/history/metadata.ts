import { TranslationError } from "../i18n";
import { isAgentSessionRef, type AgentSessionRef } from "../agent/contracts";

export const HISTORY_METADATA_KEY = "belfry.history-metadata.v1";
const MAX_TAGS = 16;
const MAX_TAG_LENGTH = 64;

export interface SessionMetadata { favorite: boolean; tags: string[] }
export type HistoryMetadata = Record<string, SessionMetadata>;
type MetadataStorage = Pick<Storage, "getItem" | "setItem">;
interface MetadataChange {
  storage: MetadataStorage;
  session: AgentSessionRef;
  patch: Partial<SessionMetadata>;
}

export function sessionKey(session: AgentSessionRef): string {
  return JSON.stringify([session.agent, session.id]);
}

export function loadMetadata(storage: Pick<Storage, "getItem">): HistoryMetadata {
  const raw = storage.getItem(HISTORY_METADATA_KEY);
  if (!raw) return {};
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new TranslationError("history.metadata.text_170a9a9c68"); }
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.entries)) {
    throw new TranslationError("history.metadata.text_9d348b6f0e");
  }
  const entries: HistoryMetadata = {};
  for (const [key, item] of Object.entries(value.entries)) {
    if (!validSessionKey(key) || !validMetadata(item)) throw new TranslationError("history.metadata.text_1e7c68c257");
    entries[key] = { favorite: item.favorite, tags: [...item.tags] };
  }
  return entries;
}

export function saveSessionMetadata({ storage, session, patch }: MetadataChange): HistoryMetadata {
  if (!isAgentSessionRef(session)) throw new TranslationError("history.metadata.text_3b194b3be2");
  const entries = loadMetadata(storage);
  const key = sessionKey(session);
  const current = entries[key] ?? { favorite: false, tags: [] };
  const next = {
    favorite: patch.favorite ?? current.favorite,
    tags: patch.tags ? normalizeTags(patch.tags.join("\n")) : current.tags,
  };
  const updated = { ...entries, [key]: next };
  storage.setItem(HISTORY_METADATA_KEY, JSON.stringify({ version: 1, entries: updated }));
  return updated;
}

export function normalizeTags(value: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(/[,，;；\n]/u)) {
    const tag = raw.trim();
    if (!tag || seen.has(tag.toLocaleLowerCase())) continue;
    if ([...tag].length > MAX_TAG_LENGTH) throw new TranslationError("history.metadata.text_4e347008ce", { limit: MAX_TAG_LENGTH });
    tags.push(tag);
    seen.add(tag.toLocaleLowerCase());
  }
  if (tags.length > MAX_TAGS) throw new TranslationError("history.metadata.text_81ec6789d0", { limit: MAX_TAGS });
  return tags;
}

function validSessionKey(key: string) {
  try {
    const value: unknown = JSON.parse(key);
    return Array.isArray(value) && value.length === 2
      && isAgentSessionRef({ agent: value[0], id: value[1] });
  } catch { return false; }
}

function validMetadata(value: unknown): value is SessionMetadata {
  return isRecord(value) && typeof value.favorite === "boolean"
    && Array.isArray(value.tags) && value.tags.length <= MAX_TAGS
    && value.tags.every((tag) => typeof tag === "string" && [...tag].length <= MAX_TAG_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
