import { describe, expect, it } from "vitest";
import type { Room, RoomMember, RoomMessage, RoomTask } from "./contracts";
import { flowGraph, FLOW_RECENT_MS } from "./flow";
import type { MemberStatus } from "./model";

const now = 1_000_000_000;

function member(id: string, title: string, role: RoomMember["role"] = "peer"): RoomMember {
  return { id, tabId: `tab-${id}`, agent: "codex", title, duty: `${title}职责`, role, joinedAt: 0, leftAt: null };
}

function task(id: string, status: RoomTask["status"], assignee: string | null): RoomTask {
  return { id, title: `${id} 标题`, outcome: "", status, assignee, blockedBy: [], notes: "", result: null,
    createdBy: "boss", createdAt: 0, updatedAt: 0, rev: 1 };
}

function message(by: string, to: string[], at: number, extra: Partial<RoomMessage> = {}): RoomMessage {
  return { id: `m-${by}-${at}`, at, kind: "chat", by, text: "", to, mode: "send", replyTo: null,
    deliveredTo: [], repliedBy: [], replyCancelled: false, ...extra };
}

function room(patch: Partial<Room> = {}): Room {
  return {
    id: "r", name: "登录改版", projectRoot: "/p", createdAt: 0,
    brief: { objective: "", currentFocus: "", constraints: [], updatedBy: null, updatedAt: null },
    members: [member("boss", "统筹员", "foreman"), member("fe", "前端"), member("be", "后端")],
    tasks: [], nextTask: 1, messages: [], ...patch,
  };
}

const allIdle = () => "idle" as MemberStatus;
const edge = (graph: ReturnType<typeof flowGraph>, source: string, target: string) =>
  graph.edges.find((item) => (item.source === source && item.target === target) || (item.source === target && item.target === source));

describe("room flow graph", () => {
  it("puts you on the left, the foreman in the middle and members around", () => {
    const graph = flowGraph(room(), allIdle, now);
    expect(graph.nodes.map((node) => node.kind)).toEqual(["user", "foreman", "peer", "peer"]);
    const [user, foreman, ...peers] = graph.nodes;
    expect(user.x).toBeLessThan(foreman.x);
    for (const peer of peers) expect(peer.x, "成员在统筹右边：派活从左往右读").toBeGreaterThan(foreman.x);
    expect(graph.edges.find((item) => item.id === "boss->fe")).toMatchObject({ sourceSide: "right", targetSide: "left" });
    expect(new Set(peers.map((peer) => `${Math.round(peer.x)},${Math.round(peer.y)}`)).size).toBe(peers.length);
    expect(graph.edges.map((item) => item.id).sort()).toEqual(["boss->be", "boss->fe", "user->boss"]);
  });

  it("shows who is working on what along the foreman's edges", () => {
    const busy = (m: RoomMember): MemberStatus => (m.id === "fe" ? "busy" : "idle");
    const graph = flowGraph(room({ tasks: [task("T2", "active", "fe"), task("T3", "planned", "fe"), task("T4", "planned", "be")] }), busy, now);
    const fe = edge(graph, "boss", "fe")!;
    expect(fe).toMatchObject({ tone: "active", label: "T2 进行中 · 1 件待开工", animated: true });
    expect(edge(graph, "boss", "be")).toMatchObject({ tone: "idle", label: "1 件待开工", animated: false });
    expect(graph.nodes.find((node) => node.id === "fe")).toMatchObject({ subtitle: "T2 T2 标题", load: 2 });
  });

  it("marks a member waiting for your choice", () => {
    const waiting = (m: RoomMember): MemberStatus => (m.id === "be" ? "waiting" : "idle");
    expect(edge(flowGraph(room(), waiting, now), "boss", "be")).toMatchObject({ tone: "waiting", label: "等你选择", animated: true });
  });

  it("lights up recent messages and adds edges between members who talked directly", () => {
    const messages = [message("fe", ["be"], now - 1_000), message("user", ["boss"], now - 1_000), message("be", ["boss"], now - FLOW_RECENT_MS - 1)];
    const graph = flowGraph(room({ messages }), allIdle, now);
    expect(edge(graph, "fe", "be")).toMatchObject({ tone: "message", animated: true });
    expect(edge(graph, "user", "boss")).toMatchObject({ tone: "message" });
    expect(edge(graph, "boss", "be"), "too old to light up").toMatchObject({ tone: "idle" });
  });

  it("shows who still owes a reply", () => {
    const messages = [message("boss", ["fe"], now - 10 * FLOW_RECENT_MS, { mode: "request_reply" })];
    expect(edge(flowGraph(room({ messages }), allIdle, now), "boss", "fe")).toMatchObject({ tone: "reply", label: "等前端回复" });
  });

  it("still draws members in a row when there is no foreman", () => {
    const graph = flowGraph(room({ members: [member("fe", "前端"), member("be", "后端")] }), allIdle, now);
    expect(graph.nodes.map((node) => node.kind)).toEqual(["user", "peer", "peer"]);
    expect(new Set(graph.nodes.map((node) => `${node.x},${node.y}`)).size).toBe(3);
    expect(graph.edges).toEqual([]);
  });
});
