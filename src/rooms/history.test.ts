import { describe, expect, it, vi } from "vitest";
import type { Room, RoomMessage } from "./contracts";
import type { RoomHistoryPage, RoomHistoryRecord } from "./history-api";
import { historyMessage, historyTimeline, RoomHistoryPager } from "./history";

const record = (id: string, at: number, offset = String(at)): RoomHistoryRecord => ({ offset, bytes: 100, truncated: false, raw: null,
  event: { v: 1, id, ts: at, room_id: "r", by: "peer", kind: "chat.message", data: { text: id, to: ["user"], message_mode: "request_reply" } } });
const page = (entries: RoomHistoryRecord[], nextCursor: string | null): RoomHistoryPage => ({ entries, nextCursor, ledgerBytes: 1000, snapshotBytes: 900 });
const message = (id: string, at: number): RoomMessage => historyMessage(record(id, at), "r")!;
const room = (messages: RoomMessage[], retainedMessages: RoomMessage[] = []): Room => ({ id: "r", name: "Room", createdAt: 0, projectRoot: "/p", ledgerBytes: 1000,
  brief: { objective: "", currentFocus: "", constraints: [], updatedAt: null, updatedBy: null }, members: [], tasks: [], nextTask: 1, messages, retainedMessages });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}

describe("room history pagination", () => {
  it("walks past the live window with opaque cursors unchanged and deduplicates page overlap", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(page([record("b", 20)], "opaque / cursor+a=="))
      .mockResolvedValueOnce(page([record("a", 10), record("b", 20)], "opaque:last?cursor=%2F"))
      .mockResolvedValueOnce(page([record("old", 1)], null));
    const pager = new RoomHistoryPager("r", fetch);
    await pager.loadEarlier(new Set(["b"]), 20);
    expect(fetch.mock.calls.map(call => call[1])).toEqual([null, "opaque / cursor+a=="]);
    expect(pager.getSnapshot().entries.map(row => row.offset)).toEqual(["10", "20"]);
    await pager.loadEarlier(new Set(["a", "b"]), 10);
    expect(fetch.mock.calls.at(-1)).toEqual(["r", "opaque:last?cursor=%2F", 200]);
    expect(pager.getSnapshot().exhausted).toBe(true);
    await pager.loadEarlier(new Set(), Infinity);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("ignores repeated load clicks and late completion after leaving the room", async () => {
    const request = deferred<RoomHistoryPage>(), fetch = vi.fn(() => request.promise), pager = new RoomHistoryPager("r", fetch);
    const pending = pager.loadEarlier(new Set(), Infinity);
    await pager.loadEarlier(new Set(), Infinity);
    expect(fetch).toHaveBeenCalledTimes(1);
    pager.cancel();
    request.resolve(page([record("stale", 1)], null));
    await pending;
    expect(pager.getSnapshot().entries).toEqual([]);
    expect(pager.getSnapshot().loading).toBe(false);
  });
  it("keeps successful overlap pages and retries the failed cursor", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(page([record("b", 20)], "cursor-2"))
      .mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValueOnce(page([record("a", 10)], null));
    const pager = new RoomHistoryPager("r", fetch);
    await pager.loadEarlier(new Set(["b"]), 20);
    expect(pager.getSnapshot()).toMatchObject({ nextCursor: "cursor-2", error: "temporarily unavailable", loading: false });
    expect(pager.getSnapshot().entries).toHaveLength(1);
    await pager.loadEarlier(new Set(["b"]), 20);
    expect(fetch.mock.calls.map(call => call[1])).toEqual([null, "cursor-2", "cursor-2"]);
    expect(pager.getSnapshot().entries).toHaveLength(2);
    expect(pager.getSnapshot().error).toBeNull();
  });
  it("stops a cursor that does not advance instead of looping forever", async () => {
    const fetch = vi.fn().mockResolvedValue(page([record("b", 20)], "same"));
    const pager = new RoomHistoryPager("r", fetch);
    await pager.loadEarlier(new Set(["b"]), 20);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(pager.getSnapshot().error).toBeTruthy();
    expect(pager.getSnapshot().loading).toBe(false);
  });
});

describe("history and current projection", () => {
  it("keeps messages that rolled out during paging and adds current arrivals exactly once", () => {
    const before = [message("a", 10), message("b", 20)];
    const current = room([message("b", 20), message("c", 30)]);
    const items = historyTimeline([record("old", 1), record("a", 10), record("b", 20)], before, current);
    expect(items.map(item => item.key)).toEqual(["message:old", "message:a", "message:b", "message:c"]);
    expect(items.filter(item => item.kind === "message" && item.historical).map(item => item.key)).toEqual(["message:old", "message:a"]);
  });
  it("prefers current and retained reply states over the original request payload", () => {
    const replied = { ...message("a", 10), repliedBy: ["user"] }, retained = { ...message("b", 20), replyCancelled: true };
    const items = historyTimeline([record("a", 10), record("b", 20)], [message("a", 10)], room([replied], [retained]));
    expect(items[0]).toMatchObject({ message: replied, historical: false });
    expect(items[1]).toMatchObject({ message: retained, historical: false });
  });
  it("does not pull retained requests into the ordinary recent timeline", () => {
    expect(historyTimeline([], [], room([message("current", 20)], [message("pending-old", 1)])).map(item => item.key)).toEqual(["message:current"]);
  });
  it("preserves malformed, unknown and truncated records for the readable fallback", () => {
    const unknown = record("unknown", 3); unknown.event!.kind = "future.kind";
    const version = record("version", 4); version.event!.v = 7;
    const malformed = record("malformed", 5); malformed.event!.data = { to: 12 };
    const invalid = { offset: "0", bytes: 100, event: null, raw: "invalid <script>data</script>", truncated: false };
    const truncated = { ...record("truncated", 1), truncated: true, raw: "partial" };
    const records = [invalid, truncated, unknown, version, malformed];
    expect(historyTimeline(records, [], room([])).map(item => item.kind)).toEqual(records.map(() => "event"));
    for (const item of records) expect(historyMessage(item, "r")).toBeNull();
    expect(historyMessage(record("other-room", 6), "different-room")).toBeNull();
  });
});
