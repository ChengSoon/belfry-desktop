import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CollabPanel } from "./CollabPanel";
import { activeTasks } from "./taskTone";
import type { DeliveryPhase, TaskView } from "./api";
import type { CollabTasksView } from "./useCollabTasks";

function task(phase: DeliveryPhase): TaskView {
  return { id: "task-delivery", shortId: "delivery", fromLabel: "planner", toLabel: "reviewer", instruction: "Review auth.ts",
    state: "queued", hop: 1, createdAt: 1, result: null, delivery: { phase, attemptId: "attempt", sequence: 7, message: "Receipt details" } };
}
function render(entry: TaskView) {
  const collab: CollabTasksView = { tasks: [entry], error: null, queryError: null, actionErrors: [], pending: new Set(),
    retry: vi.fn(), approve: vi.fn(), reject: vi.fn(), stopAll: vi.fn() };
  return renderToStaticMarkup(<CollabPanel collab={collab} onClose={vi.fn()} />);
}
it.each([
  ["accepted", "已受理"], ["queued", "排队中"], ["submitting", "正在提交"],
  ["submitted", "已提交到终端"], ["uncertain", "提交结果不确定"], ["cancelled", "投递已取消"],
] as const)("renders the %s delivery phase and preserves its reason", (phase, label) => {
  const html = render(task(phase));
  expect(html).toContain(label);
  expect(html).toContain("Receipt details");
  if (phase === "submitted") expect(html).not.toContain("已完成");
});
it("offers verification and manual resolution for uncertain delivery without a resend action", () => {
  const html = render({ ...task("uncertain"), state: "uncertain" });
  expect(html).toContain("去目标终端核对");
  expect(html).toContain("确认已提交");
  expect(html).toContain("放弃此任务");
  expect(html).not.toMatch(/<button[^>]*>[^<]*(?:重试|重新投递|重贴)/);
});
it("keeps work completion separate from the submitted receipt", () => {
  const html = render({ ...task("submitted"), state: "abandoned" });
  expect(html).toContain("已中止");
  expect(html).toContain("已提交到终端");
});
it("keeps all unresolved delivery stages in the active group", () => {
  const entries = ["accepted", "queued", "submitting", "uncertain", "dispatched", "done"].map(state => ({ ...task("accepted"), id: state, state }));
  expect(activeTasks(entries).map(task => task.id)).toEqual(["accepted", "queued", "submitting", "uncertain", "dispatched"]);
});
