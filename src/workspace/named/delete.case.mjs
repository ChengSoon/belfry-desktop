import assert from "node:assert/strict";
import test from "node:test";
import { uiFixture, click, clickText, fill, waitFor, press, evidence, theme } from "../../components/lazy/testing/production-uiFixture.mjs";

const menu = '.named-workspaces__popover';
const remove = '.named-workspaces__delete > button';
const archive = (view) => view.cdp.evaluate("JSON.parse(localStorage.getItem('belfry.named-workspaces.v1'))");

async function createWorkspace(view, name) {
  await clickText(view, '新建工作区', menu);
  await fill(view, `${menu} input`, name);
  await clickText(view, '创建', menu);
  await waitFor(view, `!document.querySelector('${menu}')`);
}

async function openConfirmation(view) {
  await click(view, remove);
  await waitFor(view, "!!document.querySelector('.modal__danger')");
  assert.equal(await view.cdp.evaluate("document.activeElement.textContent"), '取消');
}

test('workspace deletion cancels safely, preserves running sessions and persists across reload', { timeout: 60_000 }, async t => {
  const { view, origin } = await uiFixture(t);
  await theme(view, 'dark');
  await click(view, '.named-workspaces__trigger');
  assert.equal(await view.cdp.evaluate(`document.querySelector('${remove}').disabled`), true);
  const initial = await archive(view);
  const ids = initial.workspaces.flatMap(item => item.tabIds).sort();
  await createWorkspace(view, '保留会话');
  await click(view, '.named-workspaces__trigger');
  const before = await archive(view);
  await openConfirmation(view);
  await press(view, 'Escape');
  await waitFor(view, "!document.querySelector('.modal__danger')");
  assert.deepEqual(await archive(view), before);
  assert.equal(await view.cdp.evaluate(`document.activeElement === document.querySelector('${remove}')`), true);
  await clickText(view, '默认工作区', '.named-workspaces__list');
  await click(view, '.named-workspaces__trigger');
  await openConfirmation(view);
  assert.match(await view.cdp.evaluate("document.querySelector('.modal__body').textContent"), /2 个会话.*继续运行/);
  await evidence(view, 'workspace-delete-confirmation', ['.modal__danger']);
  await click(view, '.modal__danger');
  await waitFor(view, "JSON.parse(localStorage.getItem('belfry.named-workspaces.v1')).workspaces.length === 1");
  const after = await archive(view);
  assert.equal(after.workspaces[0].name, '保留会话');
  assert.deepEqual([...after.workspaces[0].tabIds].sort(), ids);
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => /session_close|terminal_close/.test(call.command)).length"), 0);
  await view.navigate({ url: origin });
  await waitFor(view, "document.querySelector('.named-workspaces__trigger')?.textContent.includes('保留会话')");
  assert.deepEqual(await archive(view), after);
  await click(view, '.named-workspaces__trigger');
  await createWorkspace(view, '待删除空工作区');
  await click(view, '.named-workspaces__trigger');
  await openConfirmation(view);
  await click(view, '.modal__danger');
  await waitFor(view, "JSON.parse(localStorage.getItem('belfry.named-workspaces.v1')).workspaces.length === 1");
  assert.deepEqual(await archive(view), after);
  await click(view, '.named-workspaces__trigger');
  await evidence(view, 'workspace-delete-last-disabled', [remove]);
});
