import { describe, expect, it } from "vitest";
import { setLocalePreference as setLocale } from "../i18n";
import type { MessageView } from "./contracts";
import { messageStatus, questionState, statusText, statusTone } from "./status";

const s = (code: string, params: Record<string, string> = {}) => ({ code, params });
function msg(over: Partial<MessageView>): MessageView {
  return { id: "e", messageId: "m", revision: 1, source: { kind: "room", roomId: null, name: "", messageId: "m" },
    recipient: { id: "r", sessionKey: "k", projectRoot: "/p", tabId: "t", roomId: null, memberId: null, name: "后端", agent: "codex" },
    topicId: "t", class: "discussion", by: { id: "a", name: "前端", tabId: null, memberId: null }, createdAt: 0, text: "",
    attachments: [], replyTo: null, questions: [], replies: [], deliveryPhase: "pending", deliveryStatus: s("queue_turn"),
    handlingStatus: s("unknown_handling"), waitingReason: null, ...over };
}

describe("收件箱状态文案", () => {
  it("等待原因用整句插值，未知码不暴露原始 code", () => {
    setLocale("zh-CN");
    expect(statusText(s("previous_task", { task: "T60" }))).toBe("等待上一任务完成 · T60");
    expect(statusText(s("turn_busy"))).toBe("等待成员结束当前轮次");
    expect(statusText(s("composer_not_empty"))).toBe("终端有未提交输入");
    expect(statusText(s("paste_not_ready"))).toBe("等待终端启用安全粘贴");
    expect(statusText(s("something_new"))).toBe("状态已更新");
    setLocale("en");
    expect(statusText(s("previous_task", { task: "T60" }))).toBe("Waiting for the previous task to finish · T60");
    setLocale("zh-CN");
  });

  it("未送达时显示等待原因；协商与新任务分别解释", () => {
    expect(messageStatus(msg({ waitingReason: s("turn_busy") })).code).toBe("turn_busy");
    expect(messageStatus(msg({ class: "task_assignment", waitingReason: s("previous_task", { task: "T60" }) })).code).toBe("previous_task");
  });

  it("送达但仍有待答问题 → 已投递待回复；部分回复后仍是待回复", () => {
    const m = msg({ deliveryPhase: "submitted", deliveryStatus: s("submitted"),
      questions: [{ id: "q1", text: "a", state: "replied", replyMessageIds: ["r"], legacy: false }, { id: "q2", text: "b", state: "open", replyMessageIds: [], legacy: false }] });
    expect(messageStatus(m).code).toBe("waiting_reply");
    expect(questionState(m.questions[0], m)).toBe("replied");
    expect(questionState(m.questions[1], m)).toBe("awaiting");
  });

  it("仅送达的非询问消息不标已处理；撤回也不标已处理", () => {
    expect(messageStatus(msg({ deliveryPhase: "submitted", deliveryStatus: s("submitted") })).code).toBe("submitted");
    expect(statusText(s("submitted"))).toContain("处理情况未知");
    expect(messageStatus(msg({ deliveryPhase: "withdrawn", deliveryStatus: s("withdrawn") })).code).toBe("withdrawn");
  });

  it("仅知会送达后显示“仅知会，已记录”", () => {
    expect(messageStatus(msg({ class: "fyi", deliveryPhase: "submitted", deliveryStatus: s("submitted") })).code).toBe("fyi");
  });

  it("未送达的问题显示“尚未送达”而不是待回复", () => {
    const m = msg({ questions: [{ id: "q", text: "x", state: "open", replyMessageIds: [], legacy: false }] });
    expect(questionState(m.questions[0], m)).toBe("notDelivered");
  });

  it("颜色：不确定为红、待回复为蓝、等待为琥珀", () => {
    expect(statusTone(s("uncertain"))).toBe("attention");
    expect(statusTone(s("waiting_reply"))).toBe("reply");
    expect(statusTone(s("turn_busy"))).toBe("waiting");
    expect(statusTone(s("submitted"))).toBe("quiet");
  });
});
