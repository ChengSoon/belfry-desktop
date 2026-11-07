import type { Room, RoomMember, RoomMessage, RoomTask, TaskStatus } from "./contracts";

/** 状态中文名，与 Rust `TaskStatus::label` 同一口径。 */
export const STATUS_LABEL: Record<TaskStatus, string> = {
  planned: "待开工",
  active: "进行中",
  done: "已完成",
  archived: "已归档",
};

export function activeMembers(room: Room): RoomMember[] {
  return room.members.filter((member) => member.leftAt === null);
}

export function foremanOf(room: Room): RoomMember | null {
  return activeMembers(room).find((member) => member.role === "foreman") ?? null;
}

/** 显示名：成员用角色名（离开的也认得出），用户与系统固定称呼。与 Rust `Room::label` 一致。 */
export function labelOf(room: Room, id: string): string {
  if (id === "user") return "你";
  if (id === "system") return "系统";
  return room.members.find((member) => member.id === id)?.title ?? "（已离开的成员）";
}

/** 消息短 id（尾 8 位），成员在终端里引用时写的就是它。 */
export function shortId(id: string): string {
  return id.slice(-8);
}

/** 还欠一句回复的收件人。与 Rust `Message::awaiting` 一致。 */
export function awaitingReply(message: RoomMessage): string[] {
  if (message.mode !== "request_reply" || message.replyCancelled) return [];
  return message.to.filter((id) => id !== "user" && !message.repliedBy.includes(id));
}

/** 还没完成的前置任务。 */
export function openBlockers(room: Room, task: RoomTask): string[] {
  return task.blockedBy.filter((id) => {
    const blocker = room.tasks.find((candidate) => candidate.id === id);
    return blocker !== undefined && blocker.status !== "done" && blocker.status !== "archived";
  });
}

/** 任务板三栏：待开工 / 进行中 / 已完成。归档的不上板。 */
export function taskColumns(room: Room): Record<"planned" | "active" | "done", RoomTask[]> {
  const columns = { planned: [] as RoomTask[], active: [] as RoomTask[], done: [] as RoomTask[] };
  for (const task of room.tasks) {
    if (task.status !== "archived") columns[task.status].push(task);
  }
  return columns;
}

export function progress(room: Room): { done: number; total: number } {
  const live = room.tasks.filter((task) => task.status !== "archived");
  return { done: live.filter((task) => task.status === "done").length, total: live.length };
}

/** 一位成员手上没完成的任务数。 */
export function workload(room: Room, memberId: string): number {
  return room.tasks.filter((task) => task.assignee === memberId && (task.status === "planned" || task.status === "active")).length;
}

export interface RecipientOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * 输入框的收件人选单。默认那一项留空：交给后端按正文 @点名、再按默认收件人（统筹）。
 * 统筹不存在时默认就是全体成员，文案照实说。
 */
export function recipientOptions(room: Room): RecipientOption[] {
  const foreman = foremanOf(room);
  const options: RecipientOption[] = [
    { value: "", label: foreman ? `统筹（${foreman.title}）` : "全体成员", description: "正文里写 @角色 会改成发给那个人" },
    { value: "@全体", label: "全体成员" },
  ];
  for (const member of activeMembers(room)) {
    options.push({ value: member.title, label: member.title, description: member.duty || undefined });
  }
  return options;
}

/** 消息下方的送达与回复注记。只记送达，读没读我们看不到。 */
export function deliveryNote(room: Room, message: RoomMessage): string | null {
  const members = message.to.filter((id) => id !== "user");
  if (message.kind !== "chat" || message.by !== "user" || members.length === 0) return null;
  const delivered = members.filter((id) => message.deliveredTo.includes(id));
  const pending = members.filter((id) => !message.deliveredTo.includes(id));
  const parts: string[] = [];
  if (delivered.length) parts.push(`已送达 ${delivered.map((id) => labelOf(room, id)).join("、")}`);
  if (pending.length) parts.push(`排队中 ${pending.map((id) => labelOf(room, id)).join("、")}`);
  return parts.join(" · ");
}

export function formatTime(at: number, now = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (date.toDateString() === today.toDateString()) return time;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

export function excerpt(text: string, limit: number): string {
  const flat = text.split(/\s+/).filter(Boolean).join(" ");
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** 新建房间时的默认班子：一位统筹 + 两位成员。用户可以改名、改职责、删行、加行。 */
export interface RosterRow {
  title: string;
  duty: string;
}

export const DEFAULT_ROSTER: RosterRow[] = [
  { title: "统筹员", duty: "拆解需求、分派任务、跟进进度、汇总结果" },
  { title: "前端", duty: "界面与交互" },
  { title: "后端", duty: "接口与数据" },
];

/** 角色名校验，与 Rust `ops::validate_title` 同一套规则；返回理由或 null。 */
const RESERVED = ["统筹", "全体", "成员", "用户", "系统", "all", "peers", "foreman", "user", "system"];
export function titleError(raw: string, taken: readonly string[]): string | null {
  const title = raw.trim().replace(/^@/, "").trim();
  if (!title) return "角色名是必填的";
  if ([...title].length > 24) return "角色名最多 24 个字";
  if (/\s/.test(title)) return "角色名不能带空格";
  if (RESERVED.some((word) => word.toLowerCase() === title.toLowerCase())) return `「${title}」是收件人记号，换个角色名`;
  if (taken.some((other) => other.toLowerCase() === title.toLowerCase())) return `已经有「${title}」了`;
  return null;
}
