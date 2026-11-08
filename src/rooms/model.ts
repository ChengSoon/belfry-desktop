import { localized, t } from "../i18n";
import type { Room, RoomMember, RoomMessage, RoomTask, TaskStatus } from "./contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import recipientProtocol from "./recipientProtocol.json";
import { formatDateTime, getLocale, formatList } from "../i18n";

/** 状态中文名，与 Rust `TaskStatus::label` 同一口径。 */
export const STATUS_LABEL: Record<TaskStatus, string> = localized(() => ({
  planned: t("rooms.model.text_21f6d811a5"),
  active: t("rooms.model.text_dc9591e56d"),
  done: t("rooms.model.text_f28461bb49"),
  archived: t("rooms.model.text_82395d4230"),
}));

export function activeMembers(room: Room): RoomMember[] {
  return room.members.filter((member) => member.leftAt === null);
}

export function foremanOf(room: Room): RoomMember | null {
  return activeMembers(room).find((member) => member.role === "foreman") ?? null;
}

/** 显示名：成员用角色名（离开的也认得出），用户与系统固定称呼。与 Rust `Room::label` 一致。 */
export function labelOf(room: Room, id: string): string {
  if (id === "user") return t("rooms.model.text_a0c7716669");
  if (id === "system") return t("rooms.model.text_5b50d7c4b5");
  return room.members.find((member) => member.id === id)?.title ?? t("rooms.model.text_969d51de6d");
}

/** 消息短 id（尾 8 位），成员在终端里引用时写的就是它。 */
export function shortId(id: string): string {
  return id.slice(-8);
}

/** Prefer the recent projection if an older retained entry has the same id. */
export function allRoomMessages(room: Room): RoomMessage[] {
  return [...new Map([...(room.retainedMessages ?? []), ...room.messages].map((message) => [message.id, message])).values()];
}

export function findRoomMessage(room: Room, id: string): RoomMessage | undefined {
  const exact = room.messages.find((message) => message.id === id) ?? room.retainedMessages?.find((message) => message.id === id);
  if (exact) return exact;
  const matches = allRoomMessages(room).filter((message) => id.length === 8 && shortId(message.id) === id);
  return matches.length === 1 ? matches[0] : undefined;
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
    { value: "", label: foreman ? t("rooms.model.text_9123e3d908", { title: foreman.title }) : t("rooms.model.text_00f17bcaa7"), description: t("rooms.model.text_52b40d24b2") },
    { value: recipientProtocol.all, label: t("rooms.model.text_00f17bcaa7") },
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
  if (delivered.length) parts.push(t("rooms.model.text_3f3fcf852b", { names: formatList(delivered.map((id) => labelOf(room, id))) }));
  if (pending.length) parts.push(t("rooms.model.text_0061201e2c", { names: formatList(pending.map((id) => labelOf(room, id))) }));
  return parts.join(" · ");
}

export function formatTime(at: number, now = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  return formatDateTime(date, { hour: "2-digit", minute: "2-digit", ...(date.toDateString() === today.toDateString() ? {} : { month: "short", day: "numeric" }) });
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

export const DEFAULT_ROSTER: RosterRow[] = localized(() => ([
  { title: t("rooms.model.text_50ae5b34eb"), duty: t("rooms.model.text_38545de184") },
  { title: t("rooms.model.text_866a4fa82c"), duty: t("rooms.model.text_6c04c43968") },
  { title: t("rooms.model.text_9b82634623"), duty: t("rooms.model.text_eda84b0713") },
]));

/** 角色名校验，与 Rust `ops::validate_title` 同一套规则；返回理由或 null。 */
const RESERVED = recipientProtocol.reserved;
export function titleError(raw: string, taken: readonly string[]): string | null {
  const title = raw.trim().replace(/^@/, "").trim();
  if (!title) return t("rooms.model.text_9d8472ded9");
  if ([...title].length > 24) return t("rooms.model.text_9549432111");
  if (/\s/.test(title)) return t("rooms.model.text_4726ac3085");
  if (RESERVED.some((word) => word.toLowerCase() === title.toLowerCase())) return t("rooms.model.text_25fa52d9c3", { title: title });
  if (taken.some((other) => other.toLowerCase() === title.toLowerCase())) return t("rooms.model.text_7d79c2fa77", { title: title });
  return null;
}

/** 同一作者连发、间隔不超过这么久的消息合成一组，只在第一条显示头像和名字。 */
export const CONTINUED_MS = 5 * 60_000;

export function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** 时间线上的日期分隔：今天 / 昨天 / 月日（跨年带年份）。 */
export function dayLabel(at: number, now = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t("rooms.model.text_d5f5a7a010");
  if (date.toDateString() === yesterday.toDateString()) return t("rooms.model.text_0c184871f6");
  return formatDateTime(date, { month: "long", day: "numeric", ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
}

/** 这条消息能不能接在上一条下面（同一作者、同一批收件人、不是回复、间隔够短）。 */
export function continues(previous: RoomMessage | undefined, message: RoomMessage): boolean {
  return previous !== undefined
    && previous.kind === "chat" && message.kind === "chat"
    && previous.by === message.by
    && message.replyTo === null
    && previous.to.join(",") === message.to.join(",")
    && message.at - previous.at < CONTINUED_MS
    && dayKey(previous.at) === dayKey(message.at);
}

/** 头像色相：按成员 id 散列，同一个人在哪儿都是同一个颜色。 */
export function hueOf(id: string): number {
  let hue = 0;
  for (const char of id) hue = (hue * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return hue;
}

/** 头像上的字：角色名第一个字（英文转大写）。 */
export function initialOf(title: string): string {
  return [...title.trim()][0]?.toUpperCase() ?? "?";
}

/** 成员此刻的状态，由他会话的活动推出来。 */
export type MemberStatus = "idle" | "busy" | "waiting" | "offline";

export const MEMBER_STATUS_TEXT: Record<MemberStatus, string> = localized(() => ({ idle: t("rooms.model.text_dae661d17c"), busy: t("rooms.model.text_963e4f4abf"), waiting: t("rooms.model.text_1247f5c788"), offline: t("rooms.model.text_be1b4f3c6c") }));

export function memberStatus(tab: Pick<WorkspaceTab, "phase" | "activity"> | undefined): MemberStatus {
  if (!tab || tab.phase !== "running") return "offline";
  if (tab.activity === "awaiting-choice") return "waiting";
  if (tab.activity === "talking") return "busy";
  return "idle";
}

// ---- @ 点名补全 ----

/** 收件人记号，与 Rust `model::expand_token` 认的中文写法一致。 */
export const MENTION_SELECTORS = localized(() => ([
  { title: getLocale() === "zh-CN" ? recipientProtocol.selectors.foreman : "foreman", description: t("rooms.model.text_0c7da839bd") },
  { title: getLocale() === "zh-CN" ? recipientProtocol.selectors.all : "all", description: t("rooms.model.text_154a8051d9") },
  { title: getLocale() === "zh-CN" ? recipientProtocol.selectors.peers : "peers", description: t("rooms.model.text_9d2a0fbc52") },
] as const));

/** 光标前正在输入的 `@名字`：返回 `@` 的位置和已经打的字；不在点名里返回 null。 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query) || query.length > 24) return null;
  // `@` 前面要是开头、空白或标点：邮箱地址、`a@b` 这种不算点名。
  if (at > 0 && /[\p{L}\p{N}_]/u.test(before[at - 1])) return null;
  return { start: at, query };
}

export interface MentionOption {
  title: string;
  description: string;
  kind: "member" | "selector";
}

/** 能点的名：在场成员（前缀匹配排前面）和收件人记号。 */
export function mentionOptions(room: Room, query: string): MentionOption[] {
  const q = query.toLowerCase();
  const score = (title: string) => {
    const lower = title.toLowerCase();
    return lower.startsWith(q) ? 0 : lower.includes(q) ? 1 : -1;
  };
  const members = activeMembers(room)
    .map((member) => ({ title: member.title, description: member.duty || (member.role === "foreman" ? t("rooms.model.text_8153348240") : t("rooms.model.text_6e6d6ddbb7")), kind: "member" as const }))
    .filter((option) => score(option.title) >= 0)
    .sort((a, b) => score(a.title) - score(b.title));
  const selectors = MENTION_SELECTORS
    .filter((selector) => score(selector.title) >= 0)
    .map((selector) => ({ ...selector, kind: "selector" as const }));
  return [...members, ...selectors];
}

/** 用选中的名字替换正在输入的 `@名字`，后面补一个空格。返回新文本和光标位置。 */
export function applyMention(text: string, caret: number, start: number, title: string) {
  const insert = `@${title} `;
  // 光标后紧跟的半截名字一起换掉；原来就有的空格不重复。
  const after = text.slice(caret).replace(/^[^\s@]*/, "").replace(/^ /, "");
  return { value: text.slice(0, start) + insert + after, caret: start + insert.length };
}

// ---- 消息里的文件路径 ----

export interface FileRef {
  /** 相对项目根的路径。 */
  path: string;
  line: number | null;
}

/** 正文里像文件路径的片段：带目录的相对路径、项目内的绝对路径，或常见源码文件名。可带 `:行号`。 */
export const FILE_PATH = /(?<![\w@/.:-])(\/(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]{1,10}|(?:\.\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]{1,10}|[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|rs|md|json|css|scss|toml|ya?ml|py|go|java|kt|swift|sh|sql|html|vue))(?::(\d+))?(?![\w/])/g;

/** 把消息里写的路径换成相对项目根的路径；在项目外或往上跳的不认（返回 null）。 */
export function projectFile(projectRoot: string, raw: string, line: number | null = null): FileRef | null {
  const root = projectRoot.replace(/[\\/]+$/, "");
  let path = raw.replace(/\\/g, "/");
  if (path.startsWith("/")) {
    if (!path.startsWith(`${root}/`)) return null;
    path = path.slice(root.length + 1);
  }
  path = path.replace(/^\.\//, "");
  if (!path || path.split("/").some((segment) => segment === ".." || segment === "")) return null;
  return { path, line };
}
