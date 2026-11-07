import type { Room, RoomMember, RoomTask } from "./contracts";
import { activeMembers, awaitingReply, foremanOf, type MemberStatus } from "./model";

/**
 * 房间的协作流程图：你 → 统筹 → 各位成员。连线表示谁把活派给了谁、谁正在做、最近谁给谁发了消息。
 *
 * 这里只算图（节点位置、连线、颜色语义），不碰 React Flow，方便单测。
 */

/** 多久以内的消息算「刚发生」，连线会亮起来。 */
export const FLOW_RECENT_MS = 2 * 60_000;

export type FlowSide = "top" | "right" | "bottom" | "left";

/** 连线的语义：做活中、刚有消息、在等你、等回复、平时。 */
export type FlowTone = "active" | "message" | "waiting" | "reply" | "idle";

export interface FlowNode {
  id: string;
  kind: "user" | "foreman" | "peer";
  /** 节点中心坐标。 */
  x: number;
  y: number;
  title: string;
  subtitle: string;
  status: MemberStatus | "user";
  memberId?: string;
  tabId?: string;
  /** 正在做的任务（进行中里最早的那件）。 */
  current: RoomTask | null;
  /** 手上没完成的任务数。 */
  load: number;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceSide: FlowSide;
  targetSide: FlowSide;
  tone: FlowTone;
  label: string | null;
  animated: boolean;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const USER_ID = "user";

function sideToward(dx: number, dy: number): FlowSide {
  if (Math.abs(dx) >= Math.abs(dy) * 0.8) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

const OPPOSITE: Record<FlowSide, FlowSide> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function tasksOf(room: Room, memberId: string) {
  const mine = room.tasks.filter((task) => task.assignee === memberId);
  return {
    active: mine.filter((task) => task.status === "active"),
    planned: mine.filter((task) => task.status === "planned"),
  };
}

/** 节点、连线的位置与语义。`statusOf` 回答成员会话此刻的状态。 */
export function flowGraph(room: Room, statusOf: (member: RoomMember) => MemberStatus, now: number): FlowGraph {
  const members = activeMembers(room);
  const foreman = foremanOf(room);
  const peers = members.filter((member) => member.id !== foreman?.id);
  const nodes: FlowNode[] = [];

  // 从左往右读：你 → 统筹 → 成员一列排开。派活的方向就是阅读的方向，一眼看得出谁把活交给了谁。
  const COLUMN = 310;
  const ROW = 104;
  const center = { x: COLUMN, y: 0 };
  nodes.push({
    id: USER_ID, kind: "user", x: 0, y: 0, title: "你", subtitle: "提需求、拍板",
    status: "user", current: null, load: 0,
  });
  const describe = (member: RoomMember, x: number, y: number, kind: "foreman" | "peer"): FlowNode => {
    const { active, planned } = tasksOf(room, member.id);
    const current = active[0] ?? null;
    const subtitle = current
      ? `${current.id} ${current.title}`
      : kind === "foreman" ? `统筹 · ${room.tasks.filter((task) => task.status === "active").length} 件进行中`
        : member.duty || (planned.length ? `${planned.length} 件待开工` : "暂时没活");
    return {
      id: member.id, kind, x, y, title: member.title, subtitle, status: statusOf(member),
      memberId: member.id, tabId: member.tabId, current, load: active.length + planned.length,
    };
  };
  if (foreman) nodes.push(describe(foreman, center.x, center.y, "foreman"));
  peers.forEach((member, index) => {
    // 成员一列，以统筹为中线上下排开；没有统筹时就排在统筹的位置上。
    const x = foreman ? center.x + COLUMN : center.x;
    const y = (index - (peers.length - 1) / 2) * ROW;
    nodes.push(describe(member, x, y, "peer"));
  });

  const position = new Map(nodes.map((node) => [node.id, node]));
  const edges = new Map<string, FlowEdge>();
  const key = (a: string, b: string) => [a, b].sort().join("~");
  const connect = (source: string, target: string, tone: FlowTone, label: string | null, animated: boolean) => {
    const from = position.get(source), to = position.get(target);
    if (!from || !to || source === target) return;
    const side = sideToward(to.x - from.x, to.y - from.y);
    edges.set(key(source, target), {
      id: `${source}->${target}`, source, target, sourceSide: side, targetSide: OPPOSITE[side], tone, label, animated,
    });
  };

  // 骨架：你 → 统筹 → 每位成员。成员手上的活标在连线上。
  if (foreman) {
    connect(USER_ID, foreman.id, "idle", null, false);
    for (const member of peers) {
      const { active, planned } = tasksOf(room, member.id);
      const status = statusOf(member);
      const parts: string[] = [];
      if (active.length) parts.push(active.length === 1 ? `${active[0].id} 进行中` : `${active.length} 件进行中`);
      if (planned.length) parts.push(`${planned.length} 件待开工`);
      if (status === "waiting") connect(foreman.id, member.id, "waiting", "等你选择", true);
      else connect(foreman.id, member.id, active.length ? "active" : "idle", parts.join(" · ") || null, active.length > 0 && status === "busy");
    }
  }

  // 最近的消息：连线亮起来；骨架之外的（成员之间、你直接找成员）临时补一条。
  for (const message of room.messages) {
    if (message.kind !== "chat" || now - message.at > FLOW_RECENT_MS) continue;
    for (const target of message.to) {
      const existing = edges.get(key(message.by, target));
      if (existing && (existing.tone === "waiting" || existing.tone === "active")) continue;
      const source = existing && existing.source !== message.by ? existing.target : message.by;
      const to = existing && existing.source !== message.by ? existing.source : target;
      connect(existing ? existing.source : source, existing ? existing.target : to, "message", existing?.label ?? "刚有消息", true);
    }
  }

  // 有人欠你一句回复，或者你还在等某人回复：标在对应连线上。
  for (const message of room.messages) {
    for (const waiter of awaitingReply(message)) {
      const existing = edges.get(key(message.by, waiter));
      if (!existing || existing.tone === "waiting") continue;
      edges.set(key(message.by, waiter), { ...existing, tone: "reply", label: `等${position.get(waiter)?.title ?? ""}回复`, animated: true });
    }
  }

  return { nodes, edges: [...edges.values()] };
}
