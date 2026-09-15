import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, click, waitFor } from "../../components/lazy/testing/browserFixture.mjs";

const PAGE = "src/workspace/testing/workspace.html";
const state = (view) => view.cdp.evaluate("JSON.parse(document.querySelector('#workspace-state').textContent)");
const ready = (view) => waitFor(view, "qa.workspace && !qa.workspace.opening");
const projectOpens = (view) => view.cdp.evaluate("qa.calls.filter(call=>call.command==='project_open').length");

test("fresh startup runs once in StrictMode and activity snapshots do not rewrite the archive", async (t) => {
  const { view } = await browserFixture(t, PAGE);
  await ready(view);
  assert.equal(1, await projectOpens(view));
  assert.equal(1, (await state(view)).tabs.length);
  const writes = await view.cdp.evaluate("qa.workspaceWrites.length");
  await view.cdp.evaluate("qa.workspace.updateTab(qa.workspace.tabs[0].id,{phase:'running',activity:'talking',lastInput:null,error:null})");
  await waitFor(view, "qa.workspace.tabs[0].activity==='talking'");
  assert.equal(writes, await view.cdp.evaluate("qa.workspaceWrites.length"));
  await click(view, "#launch-shell");
  await waitFor(view, "qa.workspace.tabs.length===2");
  assert.equal(1, await projectOpens(view));
  assert.equal((await state(view)).tabs[1].id, (await state(view)).activeTabId);
});

test("restore preserves daemon identity and named workspace focus without replaying project startup", async (t) => {
  const { view, origin } = await browserFixture(t, `${PAGE}?restored`);
  await ready(view);
  const restored = await state(view);
  assert.equal(0, await projectOpens(view));
  assert.equal("saved-a", restored.activeTabId);
  assert.equal("01arz3ndektsv4rrffq69g5fav", restored.tabs[0].restoreSessionId);
  assert.equal(undefined, restored.tabs[0].projectLaunch?.startup);
  assert.deepEqual({ QA: "1" }, restored.tabs[0].projectLaunch.env);
  await view.cdp.evaluate("qa.workspace.named.select('space-b')");
  await waitFor(view, "qa.workspace.activeTabId==='saved-b'");
  assert.deepEqual(["saved-b"], (await state(view)).visibleTabs);
  await click(view, "#launch-shell");
  await waitFor(view, "qa.workspace.tabs.length===3");
  const launched = (await state(view)).activeTabId;
  await view.cdp.evaluate("qa.workspace.named.select('space-a');qa.workspace.named.select('space-b')");
  await waitFor(view, `qa.workspace.activeTabId===${JSON.stringify(launched)}`);
  assert.equal(0, await projectOpens(view));
  await view.navigate({ url: `${origin}/${PAGE}?restored` });
  await ready(view);
  assert.equal(launched, (await state(view)).activeTabId);
  assert.equal(3, (await state(view)).tabs.length);
});

test("a user project choice supersedes delayed bootstrap and becomes persistable", async (t) => {
  const { view } = await browserFixture(t, `${PAGE}?holdDefault`);
  await waitFor(view, "qa.workspace && qa.pending.has('/qa/default')");
  await view.cdp.evaluate("qa.workspace.selectProject('/qa/chosen')");
  await ready(view);
  await view.cdp.evaluate("qa.release('/qa/default')");
  await waitFor(view, "qa.workspaceWrites.length>0");
  const current = await state(view);
  assert.equal(1, current.tabs.length);
  assert.equal("/qa/chosen", current.activeProject.rootPath);
  assert.equal("/qa/chosen", await view.cdp.evaluate("JSON.parse(localStorage.getItem('belfry.workspace.v1')).tabs[0].project.rootPath"));
});

test("out-of-order project choices cannot steal focus from the latest request", async (t) => {
  const { view } = await browserFixture(t, PAGE);
  await ready(view);
  await view.cdp.evaluate("qa.delayed.add('/qa/slow');qa.delayed.add('/qa/latest');void qa.workspace.selectProject('/qa/slow');void qa.workspace.selectProject('/qa/latest')");
  await waitFor(view, "qa.pending.size===2");
  await view.cdp.evaluate("qa.release('/qa/latest')");
  await waitFor(view, "qa.workspace.activeProject.rootPath==='/qa/latest' && !qa.workspace.opening");
  await view.cdp.evaluate("qa.release('/qa/slow')");
  const current = await state(view);
  assert.deepEqual(["/qa/default", "/qa/latest"], current.tabs.map((tab) => tab.project.rootPath));
  assert.equal("/qa/latest", current.activeProject.rootPath);
});

test("failed persistence and terminal closure remain recoverable without discarding sessions", async (t) => {
  const { view } = await browserFixture(t, PAGE);
  await ready(view);
  await view.cdp.evaluate("qa.failPersistence=true;qa.workspace.launch('shell')");
  await waitFor(view, "qa.workspace.persistenceError==='QA storage full'");
  assert.equal(2, (await state(view)).tabs.length);
  assert.equal(1, await view.cdp.evaluate("JSON.parse(localStorage.getItem('belfry.workspace.v1')).tabs.length"));
  await view.cdp.evaluate("qa.failPersistence=false;qa.workspace.retryPersistence()");
  await waitFor(view, "qa.workspace.persistenceError===null && JSON.parse(localStorage.getItem('belfry.workspace.v1')).tabs.length===2");
  await view.cdp.evaluate("qa.failClose=true;qa.workspace.closeTab(qa.workspace.activeTabId)");
  await waitFor(view, "qa.workspace.failure?.message==='QA close failed'");
  assert.equal(2, (await state(view)).tabs.length);
  await view.cdp.evaluate("qa.failClose=false;qa.workspace.closeTab(qa.workspace.activeTabId)");
  await waitFor(view, "qa.workspace.tabs.length===1");
});

test("batch history resume waits for Agent detection, preserves identities and numbers sessions distinctly", async (t) => {
  const { view } = await browserFixture(t, `${PAGE}?holdAgents`);
  await waitFor(view, "qa.workspace && qa.workspace.tabs.length===1");
  await view.cdp.evaluate(`void Promise.all(['history-a','history-b'].map(id=>qa.workspace.launchHistorySession({
    agent:'codex',id,title:id,cwd:'/qa/missing',startedAt:1,lastActiveAt:1,sessionRef:{agent:'codex',id}
  })))`);
  assert.equal(1, (await state(view)).tabs.length);
  await view.cdp.evaluate("qa.releaseAgents()");
  await waitFor(view, "qa.workspace.tabs.length===3 && !qa.workspace.opening");
  const tabs = (await state(view)).tabs.slice(1);
  assert.deepEqual(["history-a", "history-b"], tabs.map((tab) => tab.resumeSessionId));
  assert.equal(2, new Set(tabs.map((tab) => tab.title)).size);
  assert.ok(tabs.every((tab) => tab.project.rootPath === "/qa/default"));
});
