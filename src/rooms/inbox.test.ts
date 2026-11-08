import { describe, expect, it } from "vitest";
import type { RoomMessage } from "./contracts";
import { firstUnread, isUnread, latestToUser, markSeen, readSeen, toUser } from "./inbox";

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

function message(by: string, to: string[], at: number, kind: RoomMessage["kind"] = "chat"): RoomMessage {
  return { id: `${by}-${at}`, at, kind, by, text: "", to, mode: "send", replyTo: null, deliveredTo: [], repliedBy: [], replyCancelled: false };
}

describe("room inbox", () => {
  it("only counts messages someone else sent to you", () => {
    expect(toUser(message("boss", ["user"], 1))).toBe(true);
    expect(toUser(message("user", ["boss"], 1))).toBe(false);
    expect(toUser(message("boss", ["fe"], 1))).toBe(false);
    expect(toUser(message("system", ["user"], 1, "notice"))).toBe(false);
  });

  it("finds the first unread and the latest message to you", () => {
    const messages = [message("boss", ["user"], 10), message("boss", ["fe"], 20), message("boss", ["user"], 30), message("user", ["boss"], 40)];
    expect(firstUnread(messages, 0)).toBe(0);
    expect(firstUnread(messages, 10)).toBe(2);
    expect(firstUnread(messages, 30)).toBe(-1);
    expect(latestToUser(messages)).toBe(30);
    expect(latestToUser([])).toBe(0);
  });

  it("moves the seen mark forward only and drives the unread flag", () => {
    const storage = memoryStorage();
    const summary = { id: "r1", lastToUser: { id: "m", at: 50, from: "统筹员", text: "好了" } };
    expect(readSeen("r1", storage)).toBe(0);
    expect(isUnread(summary, storage)).toBe(true);
    markSeen("r1", 50, storage);
    expect(isUnread(summary, storage)).toBe(false);
    markSeen("r1", 10, storage);
    expect(readSeen("r1", storage), "不往回退").toBe(50);
    expect(isUnread({ id: "r1", lastToUser: null }, storage)).toBe(false);
  });
});
