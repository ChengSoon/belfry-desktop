import { expect, it } from "vitest";
import { roomMessageDelivery } from "./deliveryState";
import type { Room, RoomMessage } from "./contracts";

const message: RoomMessage = { id: "m", at: 1, kind: "chat", by: "user", text: "QA", to: ["peer"], mode: "send", replyTo: null, deliveredTo: [], repliedBy: [], replyCancelled: false };
const room: Room = { id: "r", name: "QA", projectRoot: "/qa", createdAt: 0, brief: { objective: "", currentFocus: "", constraints: [], updatedBy: null, updatedAt: null },
  members: [{ id: "peer", tabId: "target", title: "Reviewer", agent: "codex", duty: "", role: "peer", joinedAt: 0, leftAt: null }], tasks: [], nextTask: 1, messages: [message] };
it.each([["queued", "排队中"], ["submitting", "正在提交"], ["uncertain", "提交结果不确定"], ["cancelled", "投递已取消"]] as const)("shows room outbox %s and its reason", (phase, label) => {
  const status = roomMessageDelivery({ ...room, deliveryOutbox: [{ messageId: "m", memberId: "peer", phase, message: "Receipt reason" }] }, message);
  expect(status?.label).toContain(label); expect(status?.title).toContain("Receipt reason");
});
it("also shows delivery of a member's message to another member", () => {
  const status = roomMessageDelivery({ ...room, deliveryOutbox: [{ messageId: "m", memberId: "peer", phase: "uncertain", message: "Interrupted" }] }, { ...message, by: "foreman" });
  expect(status?.label).toContain("提交结果不确定");
});
it("describes only a confirmed terminal submission as submitted", () => {
  expect(roomMessageDelivery(room, { ...message, deliveredTo: ["peer"] })?.label).toBe("已提交到终端");
});
