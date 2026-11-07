import { describe, expect, it } from "vitest";
import type { Room, RoomMember, RoomMessage, RoomTask } from "./contracts";
import {
  awaitingReply, deliveryNote, foremanOf, labelOf, openBlockers, progress, recipientOptions, shortId, taskColumns,
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
});
