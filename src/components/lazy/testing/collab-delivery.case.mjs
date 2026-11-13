import { menuAction } from "./production-uiFixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { productionFixture, click, waitFor } from "./productionFixture.mjs";
import { browserFixture } from "./browserFixture.mjs";

const nativeSource = `(() => {
  const workspace = JSON.parse(localStorage.getItem('belfry.workspace.v1'));
  workspace.tabs.push({ ...workspace.tabs[0], id: 'delivery-target', title: 'Renamed target' });
  localStorage.setItem('belfry.workspace.v1', JSON.stringify(workspace));
  window.qaResolveCalls = [];
  window.qaTask = { id: 'task-uncertain', shortId: 'uncertain', fromLabel: 'planner', toLabel: 'Old target name', toTabId: 'delivery-target', instruction: 'Review auth.ts',
    state: 'uncertain', hop: 1, createdAt: Date.now(), result: null, delivery: { phase: 'uncertain', attemptId: 'attempt-1', sequence: 7, message: 'Receipt interrupted' } };
  const invoke = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command === 'collab_tasks') return { tasks: [structuredClone(window.qaTask)] };
    if (command === 'collab_resolve_delivery') {
      window.qaResolveCalls.push(args);
      const current = window.qaTask.delivery;
      if (current.phase !== 'uncertain' || args.attemptId !== current.attemptId || args.sequence !== current.sequence) throw { code: 'CONFLICT', message: 'Receipt changed' };
      current.phase = args.decision; current.sequence++; current.message = 'Manually resolved';
      window.qaTask.state = args.decision === 'submitted' ? 'dispatched' : 'abandoned';
      return;
    }
    return invoke(command, args);
  };
})();`;
const openCollab = view => menuAction(view, "会话协作");

test("uncertain tasks locate the stable terminal and require a current manual decision without repasting", async (t) => {
  const { view } = await productionFixture(t, { nativeSource, terminalCount: 2 });
  await openCollab(view);
  await waitFor(view, "!!document.querySelector('[data-delivery-action=locate]')");
  await click(view, "[data-delivery-action=locate]");
  await waitFor(view, "!document.querySelector('.collab-panel') && JSON.parse(localStorage.getItem('belfry.workspace.v1')).activeTabId === 'delivery-target'");
  await openCollab(view);
  await click(view, "[data-delivery-action=confirm]");
  await waitFor(view, "!!document.querySelector('[data-delivery-action=resolve]')");
  await view.cdp.evaluate("window.qaTask.delivery.sequence = 8; window.qaTask.delivery.message = 'Newer receipt'");
  await waitFor(view, "document.querySelector('.collab-event__delivery-message').textContent === 'Newer receipt'");
  await click(view, "[data-delivery-action=resolve]");
  await waitFor(view, "document.querySelector('.collab-panel__error')?.textContent.includes('状态已变更')");
  assert.equal(await view.cdp.evaluate("window.qaResolveCalls[0].sequence"), 7, "confirmation uses the receipt that was reviewed");
  assert.equal(await view.cdp.evaluate("document.querySelector('.collab-panel__error button') === null"), true, "conflicting decisions have no automatic or one-click retry");
  await click(view, "[data-delivery-action=confirm]");
  await waitFor(view, "!!document.querySelector('[data-delivery-action=resolve]')");
  await click(view, "[data-delivery-action=resolve]");
  await waitFor(view, "document.querySelector('.collab-event__state').textContent === '已提交到终端'");
  assert.equal(await view.cdp.evaluate("window.qaResolveCalls[1].sequence"), 8);
  assert.equal(await view.cdp.evaluate("__productionQA.writes.length"), 0);
  await view.cdp.evaluate("window.qaTask.state = 'uncertain'; window.qaTask.delivery.phase = 'uncertain'");
  await waitFor(view, "!!document.querySelector('[data-delivery-action=abandon]')");
  await click(view, "[data-delivery-action=abandon]");
  await waitFor(view, "!!document.querySelector('[data-delivery-action=resolve]')");
  await click(view, "[data-delivery-action=resolve]");
  await waitFor(view, "document.querySelector('.collab-event__state').textContent === '已中止'");
  assert.equal(await view.cdp.evaluate("document.querySelector('.collab-event__receipt').textContent"), "投递已取消");
  assert.equal(await view.cdp.evaluate("__productionQA.writes.length"), 0);
});

test("room delivery updates even when only the outbox changes between polls", async (t) => {
  const { view } = await browserFixture(t, "src/components/lazy/testing/rooms-qa.html?attention=0");
  await waitFor(view, "!!document.querySelector('[data-room-delivery]')");
  const id = await view.cdp.evaluate("window.qaSetDelivery('queued')");
  const selector = `[data-room-delivery="${id}"]`;
  await waitFor(view, `document.querySelector(${JSON.stringify(selector)}).textContent.includes('排队中')`);
  await view.cdp.evaluate("window.qaSetDelivery('uncertain')");
  await waitFor(view, `document.querySelector(${JSON.stringify(selector)}).textContent.includes('提交结果不确定')`);
  assert.ok(await view.cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).title.includes('QA uncertain')`));
  await view.cdp.evaluate("window.qaSetDelivery('submitted')");
  await waitFor(view, `document.querySelector(${JSON.stringify(selector)}).textContent.includes('已提交到终端')`);
});
