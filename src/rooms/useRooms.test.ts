import { describe, expect, it } from "vitest";
import type { Room, RoomMessage } from "./contracts";
import { shareRoom } from "./useRooms";

function message(id: string, text: string): RoomMessage {
  return { id, at: 1, kind: "chat", by: "user", text, to: ["boss"], mode: "send", replyTo: null,
    deliveredTo: [], repliedBy: [], replyCancelled: false };
}

function room(messages: RoomMessage[]): Room {
  return {
    id: "r", name: "房间", projectRoot: "/p", createdAt: 0,
    brief: { objective: "", currentFocus: "", constraints: [], updatedBy: null, updatedAt: null },
    members: [{ id: "boss", tabId: "t", agent: "codex", title: "统筹员", duty: "", role: "foreman", joinedAt: 0, leftAt: null }],
    tasks: [], nextTask: 1, messages,
  };
}

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

describe("shareRoom", () => {
  it("returns the previous room when a poll brings back the same data", () => {
    const previous = room([message("a", "一"), message("b", "二")]);
    expect(shareRoom(previous, copy(previous))).toBe(previous);
  });

  it("keeps unchanged messages and members and only swaps what changed", () => {
    const previous = room([message("a", "一"), message("b", "二")]);
    const next = copy(previous);
    next.messages[1] = { ...next.messages[1], deliveredTo: ["boss"] };
    next.messages.push(message("c", "三"));
    const shared = shareRoom(previous, next);
    expect(shared).not.toBe(previous);
    expect(shared.messages[0]).toBe(previous.messages[0]);
    expect(shared.messages[1]).not.toBe(previous.messages[1]);
    expect(shared.messages[1].deliveredTo).toEqual(["boss"]);
    expect(shared.messages[2].id).toBe("c");
    expect(shared.members).toBe(previous.members);
  });

  it("notices changes outside the messages", () => {
    const previous = room([message("a", "一")]);
    const renamed = { ...copy(previous), name: "新名字" };
    expect(shareRoom(previous, renamed).name).toBe("新名字");
    const paused = { ...copy(previous), paused: true };
    expect(shareRoom(previous, paused).paused).toBe(true);
    const other = { ...copy(previous), id: "other" };
    expect(shareRoom(previous, other)).toBe(other);
    expect(shareRoom(null, previous)).toBe(previous);
  });
});
