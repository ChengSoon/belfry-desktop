// 房间界面的浏览器 QA 夹具：假数据 + 假 Tauri invoke，不连真后台。
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { THEME_MODE_KEY } from "../../../theme/storage";
import "../../../styles.css";
import type { Room, RoomsView } from "../../../rooms/contracts";
import type { RoomHistoryPage, RoomHistoryRecord } from "../../../rooms/history-api";
import { setLocalePreference } from "../../../i18n";
import type { TerminalChoice } from "../../../terminal/choice";
import type { TerminalCommandTarget } from "../../../terminal/contracts";
import type { WorkspaceTab } from "../../../workspace/contracts";

const now = new Date(2026, 10, 7, 15, 30).getTime();
const min = 60_000;
const params = new URLSearchParams(location.search);
const english = params.get("locale") === "en";
if (english) setLocalePreference("en");
Object.assign(window, { qaSetLocale: setLocalePreference });
const untracked = params.get("flow") === "untracked";
const m = (id: string, tabId: string, title: string, duty: string, role: "foreman" | "peer") =>
  ({ id, tabId, agent: "codex", title, duty, role, joinedAt: now - 90 * min, leftAt: null });
const msg = (id: string, at: number, by: string, text: string, to: string[], extra: Partial<Room["messages"][number]> = {}) =>
  ({ id: `01m6v2yfg2ps6jak5pk7t${id}`, at, kind: "chat" as const, by, text, to, mode: "send" as const, replyTo: null,
    deliveredTo: to.filter((t) => t !== "user"), repliedBy: [], replyCancelled: false, ...extra });
const task = (id: string, title: string, status: Room["tasks"][number]["status"], assignee: string | null, extra: Partial<Room["tasks"][number]> = {}) =>
  ({ id, title, outcome: "", status, assignee, blockedBy: [], notes: "", result: null, createdBy: "foreman", createdAt: now - 60 * min,
    updatedAt: now - 10 * min, rev: 2, ...extra });

const room: Room = {
  id: "01m6v2yfg2ps6jak5pk7tx625h", name: "登录页改版", projectRoot: "/Users/cheng/work/Project/tool/belfry-win", createdAt: now - 2 * 60 * min,
  brief: { objective: "把登录页改成手机号 + 验证码登录，保留旧的账号密码入口；接口要兼容老客户端。", currentFocus: "先打通验证码接口",
    constraints: ["不动老的登录协议", "本周五前提测"], updatedBy: "user", updatedAt: now - 80 * min },
  members: [m("foreman", "t1", "统筹员", "拆解需求、分派任务、跟进进度", "foreman"), m("fe", "t2", "前端", "界面与交互", "peer"),
    m("be", "t3", "后端", "接口与数据", "peer"), m("qa", "t4", "测试", "回归与验收", "peer")],
  tasks: [
    task("T1", "验证码发送接口", "done", "be", { result: "POST /api/sms/send 已合并，限流 60s 一次", outcome: "返回 requestId，60 秒内重复请求返回 429" }),
    task("T2", "手机号登录页面", "active", "fe", { outcome: "输入手机号、获取验证码、倒计时、错误提示", notes: "前端：页面骨架已完成\n前端：倒计时组件联调中" }),
    task("T3", "验证码校验与登录接口", "active", "be"),
    task("T4", "登录流程回归测试", "planned", "qa", { blockedBy: ["T2", "T3"] }),
    task("T5", "旧账号密码入口保留", "planned", null),
  ],
  nextTask: 6,
  messages: [
    { ...msg("aaa001", now - 26 * 60 * min, "system", "「统筹员」以统筹身份加入了房间。", []), kind: "notice" },
    msg("aaa002", now - 80 * min, "user", "帮我把登录页改成手机号验证码登录，旧的账号密码入口先保留。", ["foreman"]),
    msg("aaa003", now - 78 * min, "foreman", "收到。我拆成 5 个任务：验证码发送、校验登录接口给后端，页面给前端，回归给测试，旧入口我先放着。", ["user"],
      { replyTo: "01m6v2yfg2ps6jak5pk7taaa002" }),
    { ...msg("aaa004", now - 77 * min, "system", "统筹员新建了 T2「手机号登录页面」，交给「前端」。", ["fe"]), kind: "notice" },
    msg("aaa005", now - 40 * min, "be", "T1 验证码发送接口已合并，限流 60s 一次。改动在 `src-tauri/src/sms.rs` 和 src/api/sms.ts:18：\n\n```ts\nawait send(phone)\n```\n- 已加限流\n- **待测**：并发重发", ["foreman"]),
    msg("aaa006", now - 39 * min, "be", "接口文档在 docs/api/sms.md。", ["foreman"]),
    msg("aaa006b", now - 30 * min, "user", "设计稿和需求文档在这里。", ["foreman"], { attachments: [
      { id: "01m6v2yfg2ps6jak5pk7tatt001", name: "登录页设计稿.png", path: "/qa/登录页设计稿.png", size: 182_400, mimeType: "image/png" },
      { id: "01m6v2yfg2ps6jak5pk7tatt002", name: "登录改版需求.pdf", path: "/qa/登录改版需求.pdf", size: 2_411_724, mimeType: "application/pdf" },
    ] }),
    msg("aaa007", now - 12 * min, "foreman", "@前端 倒计时组件今天能联调完吗？测试那边在等。", ["fe"],
      { mode: "request_reply", deliveredTo: ["fe"] }),
    msg("aaa008", now - 3 * min, "user", "进度怎么样了？", ["foreman"], { deliveredTo: [] }),
  ],
};
if (untracked) { room.tasks = []; room.messages = []; }
if (english) {
  room.name = "Login redesign";
  room.brief.objective = "Implement phone and verification-code login";
  room.brief.currentFocus = "Verification API";
  room.brief.constraints = ["Keep the existing protocol", "Ready for testing on Friday"];
  room.members.forEach((member, index) => { member.title = ["Planner", "Frontend", "Backend", "QA"][index]; member.duty = ["Plan and coordinate", "Interface", "APIs", "Testing"][index]; });
  room.tasks.forEach(task => { task.title = `Task ${task.id}`; task.outcome = "Acceptance criteria"; task.notes = "Progress note"; if (task.result) task.result = "Completed"; });
  room.messages.forEach((message, index) => { message.text = `Message ${index}`; message.attachments?.forEach((attachment, index) => { attachment.name = `Attachment ${index}`; }); });
}
const historyPages = new Map<string | null, RoomHistoryPage>();
if (params.get("history") === "1") {
  room.messages = Array.from({ length: 36 }, (_, index) => msg(`live${index}`, now - (36 - index) * min, "foreman", `Recent message ${index}`, ["user"]));
  const record = (message: Room["messages"][number], offset: string): RoomHistoryRecord => ({ offset, bytes: 200, raw: null, truncated: false,
    event: { v: 1, id: message.id, ts: message.at, by: message.by, kind: "chat.message", room_id: room.id,
      data: { text: message.text, to: message.to, message_mode: message.mode } } });
  const page = (entries: RoomHistoryRecord[], nextCursor: string | null): RoomHistoryPage => ({ entries, nextCursor, ledgerBytes: 1_572_864, snapshotBytes: 1_572_864 });
  historyPages.set(null, page(room.messages.slice(6).map((message, index) => record(message, String(2000 + index * 200))), "opaque / cursor+a=="));
  historyPages.set("opaque / cursor+a==", page([
    record(msg("history1", now - 50 * min, "foreman", "Historical request already resolved", ["user"], { mode: "request_reply" }), "1000"),
    record(msg("history2", now - 45 * min, "foreman", "Earlier message two", ["user"]), "1200"),
    ...room.messages.slice(0, 7).map((message, index) => record(message, String(1400 + index * 100))),
  ], "opaque:last?cursor=%2F"));
  historyPages.set("opaque:last?cursor=%2F", page([
    { offset: "0", bytes: 45, event: null, raw: "invalid <script>unsafe()</script> original", truncated: false },
    { offset: "100", bytes: 80_000, event: null, raw: "last 64 KiB preview", truncated: true },
    { offset: "500", bytes: 200, raw: null, truncated: false,
      event: { v: 7, id: "future-version", ts: now - 60 * min, by: "system", room_id: room.id, kind: "future.kind", data: { retained: true } } },
    { offset: "700", bytes: 200, raw: null, truncated: false,
      event: { v: 1, id: "future-event", ts: now - 55 * min, by: "system", room_id: room.id, kind: "future.kind", data: { retained: true } } },
  ], null));
  Object.assign(room, { ledgerBytes: 1_572_864 });
}
if (params.get("retained") === "1") {
  const retained = msg("retained1", now - 10_000 * min, "foreman", "这是一条较早的请求，原文仍然可以查看和回复。", ["fe"], { mode: "request_reply" });
  room.retainedMessages = [retained, structuredClone(room.messages.find((message) => message.mode === "request_reply")!)];
  room.messages[room.messages.length - 1].replyTo = retained.id;
  Object.assign(window, { qaRetainedId: retained.id });
}
const summary = (r: Room) => ({ id: r.id, name: r.name, projectRoot: r.projectRoot, createdAt: r.createdAt, objective: r.brief.objective,
  ledgerBytes: (r as Room & { ledgerBytes?: number }).ledgerBytes,
  memberCount: r.members.length, memberTabIds: r.members.map((x) => x.tabId), memberTitles: r.members.map((x) => x.title),
  foreman: r.members[0].title, openTasks: r.tasks.filter((t) => t.status === "active" || t.status === "planned").length,
  doneTasks: r.tasks.filter((t) => t.status === "done").length, lastMessageAt: r.messages.at(-1)?.at ?? null, paused: false,
  lastToUser: { id: "01m6v2yfg2ps6jak5pk7taaa003", at: now - 78 * min, from: r.members[0].title, text: english ? "I created 5 tasks" : "收到。我拆成 5 个任务" } });
const other = { ...summary(room), id: "01m6v2yfg2ps6jak5pk7tx6zzz", name: english ? "Payment callbacks" : "支付回调重构", memberCount: 2, openTasks: 1, doneTasks: 3,
  lastMessageAt: now - 300 * min, lastToUser: { id: "x", at: now - 300 * min, from: room.members[0].title, text: english ? "Ready for review" : "支付回调改好了，请验收" } };
const view: RoomsView = { rooms: [summary(room), other], loadError: null };
const secondRoom: Room = { ...structuredClone(room), id: other.id, name: other.name, messages: [] };
const roomData = new Map([[room.id, room], [secondRoom.id, secondRoom]]);
const holds = new Map<string, Array<{ promise: Promise<void>; resolve: () => void; reject: (cause: Error) => void }>>();
const pending = new Map<string, Array<{ resolve: () => void; reject: (cause: Error) => void }>>();
Object.assign(window, {
  qaRoomIds: [room.id, secondRoom.id],
  qaRollMessage: () => {
    const removed = room.messages.shift()!;
    const message = msg("live-new", Date.now(), "foreman", "Live arrival while browsing history", ["user"]);
    room.messages.push(message);
    return { removedId: removed.id, newId: message.id };
  },
  qaSetDelivery: (phase: "queued" | "uncertain" | "submitted") => {
    const message = room.messages.at(-1)!;
    room.deliveryOutbox = phase === "submitted" ? [] : [{ messageId: message.id, memberId: "foreman", phase, message: `QA ${phase}` }];
    if (phase === "submitted") message.deliveredTo = ["foreman"];
    return message.id;
  },
  qaHoldNext: (command: string) => {
    let resolve!: () => void, reject!: (cause: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    holds.set(command, [...holds.get(command) ?? [], { promise, resolve, reject }]);
  },
  qaRelease: (command: string, failure?: string) => {
    const next = pending.get(command)?.shift();
    if (!next) throw new Error(`No pending ${command}`);
    if (failure) next.reject(new Error(failure)); else next.resolve();
  },
  qaPushMessage: (id = room.id) => {
    const current = roomData.get(id)!;
    const at = Date.now();
    const message = msg(crypto.randomUUID(), at, "foreman", "请确认这一条新消息", ["user"]);
    current.messages.push(message);
    view.rooms = view.rooms.map((item) => item.id === id ? { ...item, lastToUser: { id: message.id, at, from: "统筹员", text: message.text } } : item);
    return at;
  },
});

// 一张 2×2 的 PNG，给图片附件的缩略图用。
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGNk+M/wn4GBgYGJgYGBAQAZlwMDqTHl3QAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const calls: { command: string; args: unknown }[] = [];
let imported = 0;
Object.assign(window, { qaCalls: calls });

let callback = 0;
Object.assign(window, {
  __TAURI_INTERNALS__: { metadata: { currentWindow: { label: "qa" }, currentWebview: { label: "qa", windowLabel: "qa" } },
    transformCallback: () => ++callback, unregisterCallback: () => {},
    invoke: async (command: string, args?: unknown) => {
      calls.push({ command, args });
      const hold = holds.get(command)?.shift();
      if (hold) {
        pending.set(command, [...pending.get(command) ?? [], hold]);
        await hold.promise;
      }
      const current = roomData.get((args as { id?: string })?.id ?? room.id)!;
      // 真实 IPC 每次都是一份新对象：返回拷贝，界面的结构共享才测得到。
      if (command === "room_list") return structuredClone(view);
      if (command === "room_get") return structuredClone(current);
      if (command === "room_history") {
        if (current.id !== room.id) return { entries: [], nextCursor: null, ledgerBytes: 0, snapshotBytes: 0 };
        return structuredClone(historyPages.get((args as { cursor: string | null }).cursor) ?? { entries: [], nextCursor: null, ledgerBytes: 0, snapshotBytes: 0 });
      }
      if (command === "room_read_attachment") return PNG.buffer;
      if (command === "room_clipboard_files") return [];
      if (command === "room_discard_attachment") return null;
      if (command === "room_say") return structuredClone(current);
      if (command === "room_set_paused") { room.paused = (args as { paused: boolean }).paused; return room; }
      if (command === "room_paste_attachment" || command === "room_import_attachment") {
        imported += 1;
        return { id: `01m6v2yfg2ps6jak5pk7tdrf${String(imported).padStart(3, "0")}`, name: `拖入文件${imported}.txt`,
          path: `/qa/拖入文件${imported}.txt`, size: 12, mimeType: "text/plain" };
      }
      if (command.startsWith("plugin:")) return null;
      throw new Error(`QA 未提供原生命令：${command}`);
    } },
});

const choice: TerminalChoice = {
  question: "Would you like to run the following command?", detail: "$ pnpm test src/login",
  options: [{ index: 1, label: "Yes, proceed (y)" }, { index: 2, label: "Yes, and don't ask again for this command in this session (p)" },
    { index: 3, label: "No, and tell Codex what to do differently (esc)" }], selected: 1, signature: "qa",
};
const target = (tabId: string): TerminalCommandTarget => ({ focus: () => {}, sendText: () => true,
  readChoice: () => (tabId === "t2" ? choice : null), answerChoice: () => "sent" });
const tab = (id: string, activity: WorkspaceTab["activity"]) => ({ id, kind: "codex", phase: "running", activity, title: id,
  project: { id: "p", name: "belfry-win", rootPath: room.projectRoot, rootUri: room.projectRoot } }) as unknown as WorkspaceTab;
Object.assign(window, { qaClosed: 0, qaFiles: [], qaOpened: [] });
const theme = params.get("theme") ?? "dark";
document.documentElement.dataset.theme = theme;
localStorage.setItem(THEME_MODE_KEY, theme);
const attention = params.get("attention") !== "0";
const tabs = [tab("t1", untracked ? "talking" : "idle"), tab("t2", attention ? "awaiting-choice" : "talking"), tab("t3", "talking"), tab("t4", "idle")];

const { RoomView } = await import("../../../rooms/view/RoomView");
function QaRoom() {
  const [currentTabs, setTabs] = useState(tabs);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    Object.assign(window, { qaShowRoom: setOpen, qaSetActivity: (id: string, activity: WorkspaceTab["activity"]) => {
      setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, activity } : tab));
    } });
  }, []);
  return (
  <ThemeProvider>
  <div className="app-shell is-rooms" style={{ display: "grid", height: "100vh" }}>
    {open ? <RoomView agents={[]} onClose={() => { (window as unknown as { qaClosed: number }).qaClosed += 1; setOpen(false); }}
      onOpenFile={(root, path, line) => { (window as unknown as { qaFiles: unknown[] }).qaFiles.push({ root, path, line }); }}
      onClearContext={() => true} onOpenSession={(tabId) => { (window as unknown as { qaOpened: string[] }).qaOpened.push(tabId); }} onResumeDelivery={() => true}
      pausedDeliveries={attention ? [{ tabId: "t3", message: "协作任务尚未确认开始处理" }] : []}
      project={null} tabs={currentTabs} targets={new Map(currentTabs.map((t) => [t.id, target(t.id)]))} /> : null}
  </div>
  </ThemeProvider>
  );
}
createRoot(document.getElementById("root")!).render(<QaRoom />);
