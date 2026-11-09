import assert from "node:assert/strict";
import test from "node:test";
import { productionFixture, assertTerminalInput, click, waitFor } from "../../components/lazy/testing/productionFixture.mjs";
import { sessionRecoveryQa } from "./sessionRecoveryQa.mjs";

// 生产 React、工作区存档与 xterm 全部照常运行；只替换原生 IPC，浏览器与后台数据均隔离。
const nativeSource = `(() => {
  const qa = window.__productionQA;
  const key = 'belfry.workspace.v1';
  const oldId = '01arz3ndektsv4rrffq69g5faa';
  const recoveredId = '01arz3ndektsv4rrffq69g5fab';
  const restartedId = '01arz3ndektsv4rrffq69g5fac';
  const saved = sessionStorage.getItem('qa-recovery-workspace');
  if (saved) localStorage.setItem(key, saved);
  else {
    const state = JSON.parse(localStorage.getItem(key));
    Object.assign(state.tabs[0], { kind: 'codex', profileId: 'agent:codex', daemonSessionId: oldId,
      resumeSessionId: 'saved-history', agentSessionRef: {agent: 'codex', id: 'saved-history'} });
    localStorage.setItem(key, JSON.stringify(state));
  }
  qa.nativeId = JSON.parse(localStorage.getItem(key)).tabs[0].agentSessionRef.id;
  const callbacks = new Map(), streams = new Map();
  const transform = __TAURI_INTERNALS__.transformCallback;
  __TAURI_INTERNALS__.transformCallback = (callback, once) => {
    const id = transform(callback, once); callbacks.set(id, callback); return id;
  };
  qa.emit = (event) => {
    if (event.kind === 'session_identity') qa.nativeId = event.session.id;
    const stream = streams.get(qa.pty);
    callbacks.get(stream.callback)?.({index: stream.index++, message: {sessionId: qa.pty, ...event}});
  };
  const invoke = __TAURI_INTERNALS__.invoke;
  __TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command !== 'terminal_create') return invoke(command, args);
    qa.calls.push({command, args}); qa.creates++;
    const id = args.attachment === oldId ? recoveredId : args.attachment ?? restartedId;
    qa.pty = id;
    streams.set(id, {callback: args.onEvent.id, index: 0});
    setTimeout(() => {
      qa.emit({kind: 'session_identity', session: {agent: 'codex', id: qa.nativeId}});
      qa.emit({kind: 'output', sequence: 0, eof: true,
        bytes: Array.from(new TextEncoder().encode('restored terminal ready\\r\\n> '))});
    }, 20);
    return {id, platform: 'macos', shell: 'codex', cwd: args.request.cwd,
      cols: args.request.cols, rows: args.request.rows, status: 'running', exitCode: null,
      reconnected: !!args.attachment && args.attachment !== oldId, connectionId: 'qa-' + qa.creates};
  };
})();`;

const latestCreate = (view) => view.cdp.evaluate("__productionQA.calls.filter(call=>call.command==='terminal_create').at(-1).args");
const savedTab = "JSON.parse(localStorage.getItem('belfry.workspace.v1')).tabs[0]";

test("production session recovery saves independent identity, reconnects and restarts the same conversation", { timeout: 30_000 }, async (t) => {
  const diagnostic = sessionRecoveryQa(t);
  const { view, origin } = await productionFixture(t, { nativeSource: `${nativeSource}\n${diagnostic.source}`, beforeNavigate: diagnostic.beforeNavigate });
  const initial = await latestCreate(view);
  assert.equal(initial.attachment, "01arz3ndektsv4rrffq69g5faa");
  assert.equal(initial.recoverExited, true);
  assert.equal(initial.request.resume, "saved-history");
  await waitFor(view, `${savedTab}.daemonSessionId==='01arz3ndektsv4rrffq69g5fab'`);
  await view.cdp.evaluate(`__productionQA.emit({kind:'session_identity',session:{agent:'codex',id:'latest-history'}})`);
  await waitFor(view, `${savedTab}.resumeSessionId==='latest-history'`);
  assert.deepEqual(await view.cdp.evaluate(`({creates:__productionQA.creates, removed:__productionQA.removed,
    connected:__productionQA.terminals.every(el=>el.isConnected), writes:__productionQA.writes.length})`),
  { creates: 1, removed: 0, connected: true, writes: 0 });

  await view.cdp.evaluate("__productionQA.emit({kind:'disconnected',message:'后台连接失败：connection reset'})");
  await waitFor(view, "__productionQA.creates===2 && !!document.querySelector('.xterm-helper-textarea')");
  const reconnected = await latestCreate(view);
  assert.equal(reconnected.attachment, "01arz3ndektsv4rrffq69g5fab");
  assert.equal(reconnected.recoverExited, true);
  assert.equal(reconnected.request.resume, "latest-history");
  assert.equal(0, await view.cdp.evaluate("__productionQA.calls.filter(call=>/^terminal_close/.test(call.command)).length"));

  // 用真正的新文档读取刚才生产代码写下的存档；不伪造工作区或 React 状态。
  await view.cdp.evaluate("sessionStorage.setItem('qa-recovery-workspace',localStorage.getItem('belfry.workspace.v1'))");
  await view.navigate({ url: origin });
  await waitFor(view, "__productionQA.creates===1 && !!document.querySelector('.xterm-helper-textarea')");
  const reopened = await latestCreate(view);
  assert.equal(reopened.attachment, reconnected.attachment);
  assert.equal(reopened.request.resume, "latest-history");
  await waitFor(view, `${savedTab}.resumeSessionId==='latest-history'`);

  await view.cdp.evaluate("__productionQA.emit({kind:'exit',exitCode:9,reason:'normal'})");
  await waitFor(view, "[...document.querySelectorAll('.terminal-alert button')].some(button=>button.textContent==='重启')");
  assert.equal(await view.cdp.evaluate(`(() => {
    const button=document.querySelector('.terminal-alert button'),rect=button.getBoundingClientRect();
    const top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    return top===button || button.contains(top);
  })()`), true, "恢复按钮必须能接收点击，不能被 xterm 画布挡住");
  await click(view, ".terminal-alert button");
  try { await waitFor(view, "__productionQA.creates===2"); }
  catch (error) {
    t.diagnostic(JSON.stringify(await view.cdp.evaluate(`({creates:__productionQA.creates, errors:__productionQA.errors,
      calls:__productionQA.calls.filter(call=>call.command.startsWith('terminal_'))})`)));
    throw error;
  }
  const restarted = await latestCreate(view);
  assert.equal(restarted.attachment, null);
  assert.equal(restarted.request.resume, "latest-history");
  assert.equal(0, await view.cdp.evaluate("__productionQA.writes.length"));
  await assertTerminalInput(view);
  assert.deepEqual([], await view.cdp.evaluate("__productionQA.errors"));
});
