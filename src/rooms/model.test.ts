import { describe, expect, it } from "vitest";
import type { Room, RoomMember, RoomMessage, RoomTask } from "./contracts";
import {
  applyMention, FILE_PATH, mentionOptions, mentionQuery, projectFile,
  awaitingReply, continues, CONTINUED_MS, dayLabel, deliveryNote, hueOf, initialOf, foremanOf, labelOf, openBlockers, progress, recipientOptions, shortId, taskColumns,
  titleError, workload,
} from "./model";

function member(id: string, title: string, role: RoomMember["role"] = "peer", leftAt: number | null = null): RoomMember {
  return { id, tabId: `tab-${id}`, agent: "claude", title, duty: "", role, joinedAt: 0, leftAt };
}

function task(id: string, status: RoomTask["status"], patch: Partial<RoomTask> = {}): RoomTask {
  return {
    id, title: id, outcome: "", status, assignee: null, blockedBy: [], notes: "", result: null,
    createdBy: "user", createdAt: 0, updatedAt: 0, rev: 1, ...patch,
  };
}

function message(patch: Partial<RoomMessage>): RoomMessage {
  return {
    id: "01jabcdefghjkmnpqrstvwxyz0", at: 0, kind: "chat", by: "user", text: "", to: [], mode: "send",
    replyTo: null, deliveredTo: [], repliedBy: [], replyCancelled: false, ...patch,
  };
}

function room(patch: Partial<Room> = {}): Room {
  return {
    id: "r1", name: "登录改版", projectRoot: "/proj", createdAt: 0,
    brief: { objective: "", currentFocus: "", constraints: [], updatedBy: null, updatedAt: null },
    members: [member("m1", "统筹员", "foreman"), member("m2", "前端"), member("m3", "后端"), member("m4", "旧人", "peer", 5)],
    tasks: [], nextTask: 1, messages: [], ...patch,
  };
}

describe("rooms model", () => {
  it("finds the foreman among active members and labels everyone", () => {
    const r = room();
    expect(foremanOf(r)?.title).toBe("统筹员");
    expect(labelOf(r, "user")).toBe("你");
    expect(labelOf(r, "system")).toBe("系统");
    expect(labelOf(r, "m4")).toBe("旧人");
    expect(labelOf(r, "gone")).toBe("（已离开的成员）");
    expect(foremanOf(room({ members: [member("m2", "前端")] }))).toBeNull();
  });

  it("uses the ULID tail as the short id", () => {
    expect(shortId("01jabcdefghjkmnpqrstvwxyz0")).toBe("stvwxyz0");
  });

  it("tracks who still owes a reply", () => {
    const asked = message({ mode: "request_reply", to: ["m2", "m3"], repliedBy: ["m2"] });
    expect(awaitingReply(asked)).toEqual(["m3"]);
    expect(awaitingReply({ ...asked, replyCancelled: true })).toEqual([]);
    expect(awaitingReply(message({ to: ["m2"] }))).toEqual([]);
  });

  it("splits the board into columns, counts progress, and finds open blockers", () => {
    const tasks = [
      task("T1", "done"), task("T2", "active", { assignee: "m2" }), task("T3", "planned", { assignee: "m2", blockedBy: ["T1", "T2"] }),
      task("T4", "archived"),
    ];
    const r = room({ tasks });
    const columns = taskColumns(r);
    expect(columns.planned.map((t) => t.id)).toEqual(["T3"]);
    expect(columns.active.map((t) => t.id)).toEqual(["T2"]);
    expect(columns.done.map((t) => t.id)).toEqual(["T1"]);
    expect(progress(r)).toEqual({ done: 1, total: 3 });
    expect(openBlockers(r, tasks[2])).toEqual(["T2"]);
    expect(workload(r, "m2")).toBe(2);
  });

  it("offers the foreman as the default recipient, then everyone and each member", () => {
    const options = recipientOptions(room());
    expect(options[0]).toMatchObject({ value: "", label: "统筹（统筹员）" });
    expect(options.map((o) => o.value)).toEqual(["", "@全体", "统筹员", "前端", "后端"]);
    expect(recipientOptions(room({ members: [member("m2", "前端")] }))[0].label).toBe("全体成员");
  });

  it("notes delivery only for the user's own chat messages", () => {
    const r = room();
    expect(deliveryNote(r, message({ to: ["m1", "m2"], deliveredTo: ["m1"] }))).toBe("已送达 统筹员 · 排队中 前端");
    expect(deliveryNote(r, message({ by: "m1", to: ["m2"] }))).toBeNull();
    expect(deliveryNote(r, message({ kind: "notice", to: ["m2"] }))).toBeNull();
  });

  it("validates role titles with the same rules as the backend", () => {
    expect(titleError("测试", ["前端"])).toBeNull();
    expect(titleError("", [])).toContain("必填");
    expect(titleError("前 端", [])).toContain("空格");
    expect(titleError("@全体", [])).toContain("收件人记号");
    expect(titleError("Frontend", ["frontend"])).toContain("已经有");
    expect(titleError("一二三四五六七八九十一二三四五六七八九十一二三四五", [])).toContain("24");
  });

  it("labels days and groups consecutive messages from the same author", () => {
    const noon = new Date(2026, 10, 7, 12).getTime();
    expect(dayLabel(noon, noon)).toBe("今天");
    expect(dayLabel(noon - 24 * 3_600_000, noon)).toBe("昨天");
    expect(dayLabel(new Date(2026, 0, 3).getTime(), noon)).toBe("1月3日");
    expect(dayLabel(new Date(2025, 0, 3).getTime(), noon)).toBe("2025年1月3日");
    const first = message({ by: "m1", to: ["m2"], at: noon });
    expect(continues(first, message({ by: "m1", to: ["m2"], at: noon + 1_000 }))).toBe(true);
    expect(continues(first, message({ by: "m2", to: ["m1"], at: noon + 1_000 })), "other author").toBe(false);
    expect(continues(first, message({ by: "m1", to: ["m2"], at: noon + CONTINUED_MS })), "too late").toBe(false);
    expect(continues(first, message({ by: "m1", to: ["m2"], at: noon + 1_000, replyTo: "x" })), "a reply").toBe(false);
    expect(continues(message({ kind: "notice", by: "m1", to: ["m2"], at: noon }), message({ by: "m1", to: ["m2"], at: noon }))).toBe(false);
    expect(continues(undefined, first)).toBe(false);
  });

  it("gives every member a stable avatar color and initial", () => {
    expect(hueOf("01jabc")).toBe(hueOf("01jabc"));
    expect(hueOf("01jabc")).toBeGreaterThanOrEqual(0);
    expect(hueOf("01jabc")).toBeLessThan(360);
    expect(initialOf("前端")).toBe("前");
    expect(initialOf(" reviewer")).toBe("R");
    expect(initialOf("")).toBe("?");
  });

  it("detects an @ being typed and offers members and selectors", () => {
    expect(mentionQuery("你好 @前", 5)).toEqual({ start: 3, query: "前" });
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQuery("mail me@x.com", 13), "邮箱不算").toBeNull();
    expect(mentionQuery("@前端 好", 6), "名字后面打了空格就收起").toBeNull();
    expect(mentionQuery("没有点名", 4)).toBeNull();
    const r = room();
    expect(mentionOptions(r, "").map((o) => o.title)).toEqual(["统筹员", "前端", "后端", "统筹", "全体", "成员"]);
    expect(mentionOptions(r, "端").map((o) => o.title)).toEqual(["前端", "后端"]);
    expect(mentionOptions(r, "统").map((o) => o.title)).toEqual(["统筹员", "统筹"]);
    expect(mentionOptions(r, "旧人"), "离开的成员不出现").toEqual([]);
  });

  it("replaces the half-typed name and keeps the rest of the text", () => {
    expect(applyMention("你好 @前", 5, 3, "前端")).toEqual({ value: "你好 @前端 ", caret: 7 });
    expect(applyMention("@后 接口好了吗", 2, 0, "后端")).toEqual({ value: "@后端 接口好了吗", caret: 4 });
    expect(applyMention("@后x 接口", 2, 0, "后端").value, "光标后的半截名字一起换掉").toBe("@后端 接口");
  });

  it("finds file paths in text and resolves them inside the project only", () => {
    const text = "改了 src/login/Form.tsx:42 和 docs/api/sms.md。版本 0.167.0，见 https://x.com/a.md 和 README.md，绝对路径 /proj/src/a.ts 与 /etc/passwd.conf";
    const found = [...text.matchAll(FILE_PATH)].map((m) => [m[1], m[2] ?? null]);
    expect(found, "链接里的 a.md 不算").toEqual([
      ["src/login/Form.tsx", "42"], ["docs/api/sms.md", null], ["README.md", null], ["/proj/src/a.ts", null], ["/etc/passwd.conf", null],
    ]);
    expect(projectFile("/proj", "/proj/src/a.ts")).toEqual({ path: "src/a.ts", line: null });
    expect(projectFile("/proj/", "./src/a.ts", 3)).toEqual({ path: "src/a.ts", line: 3 });
    expect(projectFile("/proj", "/etc/passwd.conf"), "项目外的不认").toBeNull();
    expect(projectFile("/proj", "../secret.md"), "往上跳的不认").toBeNull();
  });
});
