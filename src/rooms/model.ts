import type { WorkspaceTab } from "../workspace/contracts";
import type { Delivery, DeliveryState, Room, RoomMember, RoomMessage, RoomReaction, RoomTabView, RoomTask, TaskStage } from "./contracts";

/** 成员在房间视图里的在线状态；由会话快照推导，Rust 只存绑定关系。 */
export type MemberPresence = "online" | "busy" | "offline";

export type RoomTone = "waiting" | "running" | "done" | "failed" | "gone";

export interface StatusMeta {
  label: string;
  tone: RoomTone;
}

/**
 * 会话快照 → 成员状态。
 *
 * `online` 和派活闸门的 `canReceive` 是同一条线（running 且 idle）：界面允许
 * 选中的成员，后端就一定收得下。两边各算各的迟早出现「界面说能派、后端拒绝」。
 */
export function memberPresence(tab: Pick<RoomTabView, "phase" | "activity"> | undefined): MemberPresence {
  if (!tab || tab.phase === "exited" || tab.phase === "error") return "offline";
  return tab.phase === "running" && tab.activity === "idle" ? "online" : "busy";
}

export const MEMBER_PRESENCE_LABEL: Record<MemberPresence, string> = {
  online: "空闲",
  busy: "正忙",
  offline: "离线",
};

/**
 * 任务整体状态 → 面板文案与色调。
 *
 * 措辞沿用协作总线的立场：`dispatched` 不代表做完，完成只认成员自己敲的
 * `belfry done`（见 collab/taskTone.ts 的同款注释）。状态永远由文字承载。
 */
export function stageMeta(stage: TaskStage): StatusMeta {
  switch (stage) {
    case "dispatching": return { label: "排队投递中", tone: "running" };
    case "running": return { label: "进行中", tone: "running" };
    case "submitted": return { label: "已提交待验证", tone: "waiting" };
    case "verified": return { label: "验证通过", tone: "done" };
    case "rejected": return { label: "已退回重做", tone: "gone" };
    case "stopped": return { label: "已停止", tone: "gone" };
    case "failed": return { label: "有人交不了", tone: "failed" };
    case "interrupted": return { label: "结果未知", tone: "gone" };
    default: return { label: stage, tone: "gone" };
  }
}

/** 单条投递的状态文案。unknown 要把原因说清楚，别让人以为是「还在跑」。 */
export function deliveryMeta(state: DeliveryState): StatusMeta {
  switch (state) {
    case "queued": return { label: "排队等对方空闲", tone: "running" };
    case "dispatched": return { label: "已送达 · 完成情况未知", tone: "running" };
    case "done": return { label: "已交差", tone: "done" };
    case "failed": return { label: "对方说做不了", tone: "failed" };
    case "abandoned": return { label: "已停止或会话不在了", tone: "gone" };
    case "unknown": return { label: "结果未知（应用重启或任务已回收）", tone: "gone" };
    default: return { label: state, tone: "gone" };
  }
}

/** 24 小时制 HH:MM。 */
export function formatRoomTime(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function memberOf(room: Room, memberId: string): RoomMember | undefined {
  return room.members.find((member) => member.id === memberId);
}

/** 引用了已移除成员的历史消息，也要能读出说话的人。 */
export function memberName(room: Room, memberId: string): string {
  return memberOf(room, memberId)?.role ?? "（已移除的成员）";
}

/**
 * 找出文本里的 @点名（与后端 parse_mentions 同一把尺）：长角色名先匹配并遮住短名
 * （「前端 2」命中后「前端」不再重复点名）；点名后面还跟着字母/汉字的算词的一部分，
 * 不当点名（避免 `@审查员` 误点「审查」）。发送按钮据此显示真实投递对象。
 */
export function mentionedMembers(text: string, members: readonly RoomMember[]): RoomMember[] {
  return mentionSpans(text, members.filter((member) => member.leftAt === null)).map((span) => span.member);
}

/** 一段 @点名在原文里的位置（半开区间 [start, end)）与命中的成员。 */
interface MentionSpan {
  start: number;
  end: number;
  member: RoomMember;
}

/**
 * 扫描出文中所有 @点名的区间。长角色名先匹配并遮住短名（「前端 2」命中后「前端」
 * 不再重复点名）；点名后面还跟着字母/汉字的算词的一部分（`@审查员` 不点「审查」）。
 * 与后端 `parse_mentions` 是同一把尺——界面高亮与真实投递必须指着同一批人。
 */
function mentionSpans(text: string, members: readonly RoomMember[]): MentionSpan[] {
  const candidates = [...members].sort(
    (left, right) => Array.from(right.role).length - Array.from(left.role).length,
  );
  const taken: Array<[number, number]> = [];
  const found: MentionSpan[] = [];
  for (const member of candidates) {
    const needle = `@${member.role}`;
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at < 0) break;
      const end = at + needle.length;
      const next = Array.from(text.slice(end))[0];
      const boundary = next === undefined || !/[\p{L}\p{N}]/u.test(next);
      const shadowed = taken.some(([start, stop]) => at < stop && start < end);
      if (boundary && !shadowed) {
        taken.push([at, end]);
        found.push({ start: at, end, member });
        break;
      }
      from = end;
    }
  }
  return found.sort((left, right) => left.start - right.start);
}

/** 正文里的一个片段：命中了 @点名就是那段点名，否则是普通文本。 */
export interface MentionSegment {
  text: string;
  /** 命中点名时是那位成员；否则为 null。 */
  member: RoomMember | null;
}

/**
 * 把正文切成「普通文字 / @点名」段，拼回去等于原文。界面据此把点名画成芯片——
 * 读对话时一眼看清在叫谁，也是「@ 谁只发给谁」在视觉上的对应。
 * 用房间的全部成员（含已离开的）：历史消息里的点名也要照旧高亮。
 */
export function splitMentions(text: string, members: readonly RoomMember[]): MentionSegment[] {
  const spans = mentionSpans(text, members);
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const span of spans) {
    if (span.start > last) segments.push({ text: text.slice(last, span.start), member: null });
    segments.push({ text: text.slice(span.start, span.end), member: span.member });
    last = span.end;
  }
  if (last < text.length) segments.push({ text: text.slice(last), member: null });
  return segments;
}

/**
 * 群聊消息的送达注记。
 *
 * 只记「送达」（投递真的进过对方终端），不假装「已读」——成员的屏幕我们看不到，
 * 猜出来的已读迟早说谎。没人回过、也没送出时退回「发给了 …」。
 */
export function chatDeliveryNote(room: Room, message: Pick<RoomMessage, "memberIds" | "deliveredTo">): string {
  const names = (ids: string[]) => ids.map((id) => memberName(room, id)).join("、");
  const deliveredTo = message.deliveredTo ?? [];
  const delivered = message.memberIds.filter((id) => deliveredTo.includes(id));
  if (delivered.length === 0) return `发给了 ${names(message.memberIds)}`;
  const rest = message.memberIds.filter((id) => !deliveredTo.includes(id));
  return rest.length === 0 ? `已送达 ${names(delivered)}` : `已送达 ${names(delivered)} · 未确认 ${names(rest)}`;
}

/** 表情回应按 emoji 归组：计数、谁点的、自己点没点（界面高亮用）。 */
export interface ReactionGroup {
  emoji: string;
  count: number;
  memberIds: string[];
  mine: boolean;
}

export function groupReactions(reactions: RoomReaction[] | undefined, viewer = "user"): ReactionGroup[] {
  const groups: ReactionGroup[] = [];
  for (const reaction of reactions ?? []) {
    const group = groups.find((item) => item.emoji === reaction.emoji);
    if (group) {
      group.count += 1;
      group.memberIds.push(reaction.memberId);
      group.mine ||= reaction.memberId === viewer;
    } else {
      groups.push({
        emoji: reaction.emoji,
        count: 1,
        memberIds: [reaction.memberId],
        mine: reaction.memberId === viewer,
      });
    }
  }
  return groups;
}

export function taskOf(room: Room, taskId: string): RoomTask | undefined {
  return room.tasks.find((task) => task.id === taskId);
}

/** 需要盯着的任务：投递中 / 进行中 / 待验证。 */
export function activeRoomTasks(room: Room): RoomTask[] {
  return room.tasks.filter((task) =>
    task.stage === "dispatching" || task.stage === "running" || task.stage === "submitted");
}

/** 已结束的任务：验证通过 / 已退回 / 已停止 / 失败 / 结果未知。 */
export function finishedRoomTasks(room: Room): RoomTask[] {
  return room.tasks.filter((task) =>
    task.stage === "verified" || task.stage === "rejected" || task.stage === "stopped"
    || task.stage === "failed" || task.stage === "interrupted");
}

/** 单条投递能不能就地重派：任务没结束，且这条没有在途或已交差的结果。 */
export function deliveryRetryable(task: RoomTask, delivery: Delivery): boolean {
  if (task.stage === "verified" || task.stage === "rejected" || task.stage === "stopped") return false;
  return delivery.state === "unknown" || delivery.state === "abandoned" || delivery.state === "failed";
}

export interface ResultSegment {
  text: string;
  /** 看起来像文件路径时的原文；否则为 null。 */
  candidate: string | null;
}

/** 一段带斜杠的目录加带扩展名的文件名；允许 file://、绝对路径与 Windows 反斜杠。 */
const RESULT_PATH_PATTERN = /file:\/\/[^\s"'`，。；：！？（）()【】「」]+|(?:[A-Za-z]:[\\/]|\/)?(?:[\w.@+-]+[\\/])+[\w.@+-]+\.[A-Za-z0-9]{1,8}/gu;

/** 普通 URL（file:// 除外，它本身就指向本地文件）。 */
const PLAIN_URL_PATTERN = /[A-Za-z][\w.@+-]*:\/\/\S+/gu;

/**
 * 把交差回执切成「正文 / 疑似路径」段。这里只负责认形状；能不能打开
 * 由调用方拿项目根再判一次（projectRelativePath），避免把 URL 片段当文件。
 */
export function splitResultPaths(text: string): ResultSegment[] {
  // 先圈出普通 URL 的范围：URL 里的路径片段不算文件，file:// 本身除外。
  const urls: Array<[number, number]> = [];
  for (const match of text.matchAll(PLAIN_URL_PATTERN)) {
    if (match[0].toLocaleLowerCase().startsWith("file:")) continue;
    const start = match.index ?? 0;
    urls.push([start, start + match[0].length]);
  }
  const insideUrl = (index: number) => urls.some(([from, to]) => index >= from && index < to);
  const segments: ResultSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(RESULT_PATH_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), candidate: null });
    segments.push({ text: match[0], candidate: insideUrl(start) ? null : match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), candidate: null });
  return segments;
}

/** 引用块里的原文摘要：压平空白、超长截断。 */
export function quoteSnippet(text: string, max = 60): string {
  const flat = text.split(/\s+/u).filter(Boolean).join(" ");
  const chars = Array.from(flat);
  return chars.length <= max ? flat : `${chars.slice(0, max).join("")}…`;
}

/** 时间线的日期分隔：今天 / 昨天 / M月D日。 */
export function formatRoomDay(at: number, now = Date.now()): string {
  const day = new Date(at);
  const today = new Date(now);
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(day)) / 86_400_000);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  return `${day.getMonth() + 1}月${day.getDate()}日`;
}

/** 房间列表的最近活动：一分钟内「刚刚」、当天给钟点、更早给日期，一眼看出房间多久没动静。 */
export function formatRoomActivity(at: number, now = Date.now()): string {
  if (now - at < 60_000) return "刚刚";
  const day = formatRoomDay(at, now);
  return day === "今天" ? formatRoomTime(at) : day;
}

/** 同一位作者在这个窗口内的连发合并成一段（聊天软件的节奏）。 */
export const CONTINUED_WINDOW_MS = 120_000;

/**
 * 导出用的验证记录：纯文本、无时间戳（时区无关，测试可钉死）。
 * 顺序照任务详情的读法：身份 → 正文 → 验收 → 投递 → 备注。
 */
export function taskRecord(room: Room, task: RoomTask): string {
  const lines: string[] = [
    `房间：${room.name}`,
    `任务：${task.title}`,
    `状态：${stageMeta(task.stage).label} · 第 ${task.attempt} 轮`,
    "派发内容：",
    task.text,
  ];
  if (task.acceptance.length > 0) {
    lines.push("", "验收要点：");
    task.acceptance.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
  }
  lines.push("", "投递：");
  for (const delivery of task.deliveries) {
    const state = deliveryMeta(delivery.state);
    const result = delivery.result ? ` —— ${delivery.result}` : "";
    lines.push(`- ${memberName(room, delivery.memberId)}：${state.label}${result}`);
  }
  if (task.artifact) {
    lines.push(
      "",
      task.artifact.text.trim()
        ? `证据：交差时的工作区差异快照（${task.artifact.text.length} 字${task.artifact.truncated ? "，已截断" : ""}）`
        : "证据：交差时工作区没有未提交的改动",
    );
  }
  if (task.verificationNote) lines.push("", `验证备注：${task.verificationNote}`);
  if (task.rejectionNote) lines.push(`退回说明：${task.rejectionNote}`);
  return lines.join("\n");
}
