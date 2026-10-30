import { describe, expect, it } from "vitest";
import type { Delivery, DeliveryState, Room, RoomMember, RoomReaction, RoomTask, TaskStage } from "./contracts";
import { activeRoomTasks, chatDeliveryNote, deliveryMeta, deliveryRetryable, formatRoomActivity, formatRoomDay, formatRoomTime, groupReactions, memberPresence, mentionedMembers, quoteSnippet, splitMentions, splitResultPaths, stageMeta, taskRecord } from "./model";

function task(stage: TaskStage): RoomTask {
  return {
    id: `t-${stage}`,
    title: "合成任务",
    text: "把登录失败的错误提示统一成内联样式",
    memberIds: [],
    acceptance: [],
    createdAt: 0,
    stage,
    attempt: 1,
    deliveries: [],
    verifiedAt: null,
    verificationNote: null,
    rejectedAt: null,
    rejectionNote: null,
    stoppedAt: null,
    artifact: null,
  };
}

function room(tasks: RoomTask[]): Room {
  return { id: "r-1", name: "合成房间", projectRoot: "/qa/project", extraRoots: [], createdAt: 0,
    members: [], messages: [], decisions: [],
  delegations: [], tasks };
}

describe("memberPresence", () => {
  it("keeps the selectable line identical to the dispatch gate's canReceive", () => {
    expect(memberPresence(undefined)).toBe("offline");
    expect(memberPresence({ phase: "exited", activity: "idle" })).toBe("offline");
    expect(memberPresence({ phase: "error", activity: "idle" })).toBe("offline");
    expect(memberPresence({ phase: "running", activity: "idle" })).toBe("online");
    expect(memberPresence({ phase: "running", activity: "talking" })).toBe("busy");
    expect(memberPresence({ phase: "running", activity: "awaiting-choice" })).toBe("busy");
    expect(memberPresence({ phase: "creating", activity: "idle" })).toBe("busy");
  });
});

describe("stageMeta", () => {
  it("keeps completion honest: in-flight labels never read as done", () => {
    const stages: TaskStage[] = ["dispatching", "running", "submitted", "verified", "rejected", "stopped", "failed", "interrupted"];
    const labels = stages.map((stage) => stageMeta(stage).label);
    expect(new Set(labels).size).toBe(stages.length);
    expect(stageMeta("dispatching").tone).toBe("running");
    expect(stageMeta("running").tone).toBe("running");
    expect(stageMeta("submitted").tone).toBe("waiting");
    expect(stageMeta("verified").tone).toBe("done");
    expect(stageMeta("rejected").tone).toBe("gone");
    expect(stageMeta("rejected").label).toContain("退回");
    expect(stageMeta("failed").tone).toBe("failed");
    expect(stageMeta("interrupted").tone).toBe("gone");
  });
});

describe("deliveryMeta", () => {
  it("keeps the unknown state visible instead of pretending progress", () => {
    expect(deliveryMeta("queued").label).toContain("排队");
    expect(deliveryMeta("dispatched").label).toContain("完成情况未知");
    expect(deliveryMeta("done").tone).toBe("done");
    expect(deliveryMeta("failed").tone).toBe("failed");
    expect(deliveryMeta("abandoned").tone).toBe("gone");
    expect(deliveryMeta("unknown").label).toContain("结果未知");
  });
});

describe("formatRoomTime", () => {
  it("renders 24h HH:MM with zero padding", () => {
    expect(formatRoomTime(new Date(2026, 0, 2, 9, 5).getTime())).toBe("09:05");
    expect(formatRoomTime(new Date(2026, 0, 2, 23, 59).getTime())).toBe("23:59");
  });
});

describe("activeRoomTasks", () => {
  it("only keeps tasks that still need attention, in creation order", () => {
    const view = room([task("dispatching"), task("running"), task("submitted"), task("verified"), task("stopped"), task("interrupted")]);
    expect(activeRoomTasks(view).map((item) => item.stage)).toEqual(["dispatching", "running", "submitted"]);
  });
});

describe("deliveryRetryable", () => {
  it("only offers a per-member re-send for unsettled deliveries on open tasks", () => {
    function delivery(state: DeliveryState): Delivery {
      return { memberId: "m-1", busTaskId: "bus-1", state, result: null, at: 0 };
    }
    const open = task("running");
    expect(deliveryRetryable(open, delivery("unknown"))).toBe(true);
    expect(deliveryRetryable(open, delivery("abandoned"))).toBe(true);
    expect(deliveryRetryable(open, delivery("failed"))).toBe(true);
    expect(deliveryRetryable(open, delivery("done"))).toBe(false);
    expect(deliveryRetryable(open, delivery("queued"))).toBe(false);
    expect(deliveryRetryable(task("verified"), delivery("failed"))).toBe(false);
    expect(deliveryRetryable(task("rejected"), delivery("failed"))).toBe(false);
    expect(deliveryRetryable(task("stopped"), delivery("failed"))).toBe(false);
  });
});

describe("splitResultPaths", () => {
  it("挑出回执里的路径，正文原样保留且可拼回", () => {
    const text = "改完了，见 /qa/proj/src/login.ts 与 file:///qa/proj/docs/a.md；另外 src/ui/button.tsx 也动了";
    const segments = splitResultPaths(text);
    expect(segments.filter((segment) => segment.candidate).map((segment) => segment.text))
      .toEqual(["/qa/proj/src/login.ts", "file:///qa/proj/docs/a.md", "src/ui/button.tsx"]);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
  });

  it("没有斜杠的普通词与 URL 片段不当作路径", () => {
    expect(splitResultPaths("package.json 和 README 都看过了").every((segment) => segment.candidate === null)).toBe(true);
    expect(splitResultPaths("截图见 https://example.com/qa/a.png 里").every((segment) => segment.candidate === null)).toBe(true);
  });
});

describe("taskRecord", () => {
  it("把任务全貌导出为稳定的纯文本", () => {
    const member: RoomMember = { id: "m-1", tabId: "tab-a", agent: "claude", role: "前端", duty: "", joinedAt: 0, leftAt: null };
    const view: Room = {
      id: "r-1", name: "发布检查", projectRoot: "/qa/project", extraRoots: [], createdAt: 0,
      members: [member], messages: [], decisions: [],
  delegations: [],
      tasks: [{
        id: "t-1", title: "统一登录失败的错误提示", text: "把登录失败的错误提示统一成内联样式",
        memberIds: ["m-1"], acceptance: ["错误提示是内联的", "失败可重试"], createdAt: 0,
        stage: "verified", attempt: 1,
        deliveries: [{ memberId: "m-1", busTaskId: "bus-1", state: "done", result: "都改好了", at: 0 }],
        verifiedAt: 1, verificationNote: "已在真机确认", rejectedAt: null, rejectionNote: null, stoppedAt: null, artifact: null,
      }],
    };
    expect(taskRecord(view, view.tasks[0])).toBe([
      "房间：发布检查",
      "任务：统一登录失败的错误提示",
      "状态：验证通过 · 第 1 轮",
      "派发内容：",
      "把登录失败的错误提示统一成内联样式",
      "",
      "验收要点：",
      "1. 错误提示是内联的",
      "2. 失败可重试",
      "",
      "投递：",
      "- 前端：已交差 —— 都改好了",
      "",
      "验证备注：已在真机确认",
    ].join("\n"));
  });
});

describe("taskRecord 证据行", () => {
  it("有快照时导出摘要，空差异说清没有改动", () => {
    const member: RoomMember = { id: "m-1", tabId: "tab-a", agent: "claude", role: "前端", duty: "", joinedAt: 0, leftAt: null };
    function record(text: string, truncated: boolean): string {
      const view: Room = {
        id: "r-1", name: "发布检查", projectRoot: "/qa/project", extraRoots: [], createdAt: 0,
        members: [member], messages: [], decisions: [],
  delegations: [],
        tasks: [{
          id: "t-1", title: "调提示", text: "调提示", memberIds: ["m-1"], acceptance: [], createdAt: 0,
          stage: "submitted", attempt: 1,
          deliveries: [{ memberId: "m-1", busTaskId: "bus-1", state: "done", result: null, at: 0 }],
          verifiedAt: null, verificationNote: null, rejectedAt: null, rejectionNote: null, stoppedAt: null,
          artifact: { capturedAt: 1, truncated, text },
        }],
      };
      return taskRecord(view, view.tasks[0]);
    }
    expect(record("diff --git a/x b/x\n+1", false)).toContain("证据：交差时的工作区差异快照（");
    expect(record("diff", true)).toContain("已截断");
    expect(record("   ", false)).toContain("证据：交差时工作区没有未提交的改动");
  });
});

describe("formatRoomDay", () => {
  it("labels today, yesterday and older days", () => {
    const now = new Date(2026, 9, 29, 12, 0, 0).getTime();
    const at = (day: number) => new Date(2026, 9, day, 9, 0, 0).getTime();
    expect(formatRoomDay(at(29), now)).toBe("今天");
    expect(formatRoomDay(at(28), now)).toBe("昨天");
    expect(formatRoomDay(at(20), now)).toBe("10月20日");
  });
});

describe("formatRoomActivity", () => {
  it("reads as just-now, clock time, or a day label", () => {
    const now = new Date(2026, 9, 29, 12, 0, 0).getTime();
    expect(formatRoomActivity(now - 30_000, now)).toBe("刚刚");
    expect(formatRoomActivity(new Date(2026, 9, 29, 9, 5).getTime(), now)).toBe("09:05");
    expect(formatRoomActivity(new Date(2026, 9, 28, 9, 5).getTime(), now)).toBe("昨天");
    expect(formatRoomActivity(new Date(2026, 9, 20, 9, 5).getTime(), now)).toBe("10月20日");
  });
});

describe("chatDeliveryNote", () => {
  const members: RoomMember[] = [
    { id: "m-1", tabId: "tab-a", agent: "claude", role: "前端", duty: "", joinedAt: 0, leftAt: null },
    { id: "m-2", tabId: "tab-b", agent: "codex", role: "审查", duty: "", joinedAt: 0, leftAt: null },
  ];
  const base = () => ({ ...room([]), members });

  it("moves from 发给了 to 已送达 and 未确认 as receipts land", () => {
    // 只记送达，不假装读过：没回执的成员如实标「未确认」。
    expect(chatDeliveryNote(base(), { memberIds: ["m-1", "m-2"], deliveredTo: [] })).toBe("发给了 前端、审查");
    expect(chatDeliveryNote(base(), { memberIds: ["m-1", "m-2"], deliveredTo: ["m-1"] })).toBe("已送达 前端 · 未确认 审查");
    expect(chatDeliveryNote(base(), { memberIds: ["m-1", "m-2"], deliveredTo: ["m-2", "m-1"] })).toBe("已送达 前端、审查");
  });
});

describe("quoteSnippet", () => {
  it("flattens whitespace and truncates long quotes", () => {
    expect(quoteSnippet("第一行\n第二行")).toBe("第一行 第二行");
    const long = "这是一句会超过六十个字的长消息".repeat(6);
    const snippet = quoteSnippet(long);
    expect(Array.from(snippet).length).toBe(61);
    expect(snippet.endsWith("…")).toBe(true);
  });
});

describe("mentionedMembers", () => {
  const members: RoomMember[] = [
    { id: "m-1", tabId: "tab-a", agent: "claude", role: "前端", duty: "", joinedAt: 0, leftAt: null },
    { id: "m-2", tabId: "tab-b", agent: "codex", role: "审查", duty: "", joinedAt: 0, leftAt: null },
    { id: "m-3", tabId: "tab-c", agent: "claude", role: "前端 2", duty: "", joinedAt: 0, leftAt: null },
  ];

  it("parses @roles with the same ruler as the backend", () => {
    expect(mentionedMembers("@审查 你看下", members).map((member) => member.id)).toEqual(["m-2"]);
    expect(mentionedMembers("@审查员 麻烦看下", members)).toEqual([]);
    expect(mentionedMembers("@前端 2 你来", members).map((member) => member.id)).toEqual(["m-3"]);
    expect(mentionedMembers("大家同步一下", members)).toEqual([]);
  });
});

describe("splitMentions", () => {
  const members: RoomMember[] = [
    { id: "m-1", tabId: "tab-a", agent: "claude", role: "前端", duty: "", joinedAt: 0, leftAt: null },
    { id: "m-2", tabId: "tab-b", agent: "codex", role: "审查", duty: "", joinedAt: 0, leftAt: null },
    { id: "m-3", tabId: "tab-c", agent: "claude", role: "前端 2", duty: "", joinedAt: 0, leftAt: null },
  ];

  it("切出点名段，拼回去等于原文，规则与后端一致", () => {
    const text = "@审查 接口草稿推上去了，你看下";
    const segments = splitMentions(text, members);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(segments.filter((segment) => segment.member).map((segment) => segment.text)).toEqual(["@审查"]);
    expect(segments.find((segment) => segment.member)?.member?.id).toBe("m-2");
    // @审查员 不点「审查」：词的一部分不算点名，整段是普通文字。
    expect(splitMentions("@审查员 麻烦看下", members).every((segment) => segment.member === null)).toBe(true);
    // 长角色名优先：「前端 2」不被「前端」截胡。
    expect(splitMentions("@前端 2 你来", members).find((segment) => segment.member)?.member?.id).toBe("m-3");
  });
});

describe("groupReactions", () => {
  it("groups by emoji and marks the viewer's own reactions", () => {
    const reactions: RoomReaction[] = [
      { memberId: "user", emoji: "👍", at: 1 },
      { memberId: "m-2", emoji: "👍", at: 2 },
      { memberId: "m-2", emoji: "✅", at: 3 },
    ];
    const groups = groupReactions(reactions);
    expect(groups.map((group) => [group.emoji, group.count, group.mine])).toEqual([
      ["👍", 2, true],
      ["✅", 1, false],
    ]);
    expect(groupReactions(undefined)).toEqual([]);
  });
});
