import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { click, clickText, evidence, fill, intact, menuAction, press, resize, settings, theme, uiFixture, waitFor } from "./production-uiFixture.mjs";
import { englishPanel, switchLanguage } from "./i18n-browser-support.mjs";

const nativeExtension = await readFile(new URL("../../../a2a/testing/native.js", import.meta.url), "utf8");
const cardUrl = "http://127.0.0.1:17777/.well-known/agent-card.json";
async function a2a(view) {
  if (!await view.cdp.evaluate("!!document.querySelector('.a2a-panel')")) await click(view, '.workbench-a2a');
  await waitFor(view, "!!document.querySelector('.a2a-panel .a2a-section') && !!document.querySelector('.a2a-map')");
  // The link map keeps decorative loops running (orbit, flow, pulse); only the
  // finite entrance animation should be awaited.
  await view.cdp.evaluate("Promise.all(document.getAnimations().filter(a => a.effect?.target?.closest?.('.a2a-panel') && a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))");
}
async function add(view, name = "Synthetic remote reviewer") {
  await a2a(view); await clickText(view, "新增连接", ".a2a-section");
  await fill(view, "#a2a-name", name); await fill(view, "#a2a-cardUrl", cardUrl);
}
async function choose(view, id, label) {
  await click(view, `#${id}`);
  await waitFor(view, `[...document.querySelectorAll('[role="option"]')].some(option => option.textContent.includes(${JSON.stringify(label)}))`);
  await clickText(view, label, '[role="listbox"]');
  await waitFor(view, "!document.querySelector('[role=\"listbox\"]')");
}

test("production project A2A entry protects drafts and configures, probes, retains/clears credentials and removes connections", async t => {
  const { view, baseline } = await uiFixture(t, { nativeExtension });
  await settings(view);
  assert.doesNotMatch(await view.cdp.evaluate("document.querySelector('.settings-nav').textContent"), /A2A/);
  await click(view, '.settings-topbar > button');
  await waitFor(view, "!document.querySelector('.settings-view')");
  await theme(view, "dark");
  await a2a(view); await waitFor(view, "!document.querySelector('.a2a-spinner')");
  assert.equal(await view.cdp.evaluate("document.querySelectorAll('.a2a-tabs').length"), 0);
  await evidence(view, "a2a-project-empty-desktop", ['.a2a-panel__close', '.a2a-intro .a2a-button--primary']);
  await add(view);
  await choose(view, "a2a-authKind", "静态 Bearer"); await fill(view, "#a2a-secret", "fixture-a2a-token");
  assert.equal(await view.cdp.evaluate("document.querySelector('#a2a-secret').type"), "password");
  await waitFor(view, "document.querySelector('.a2a-panel__close').disabled");
  assert.equal(await view.cdp.evaluate("document.querySelector('.workbench').inert && document.querySelector('.sidebar-shell').inert"), true);
  await press(view, "Escape");
  assert.equal(await view.cdp.evaluate("document.querySelector('#a2a-secret').value"), "fixture-a2a-token");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.a2a-panel') && !document.querySelector('.settings-view')"), true);
  await evidence(view, "a2a-project-editor-desktop", ['.a2a-form button[type="submit"]']);
  await clickText(view, "检测连接", ".a2a-form"); await waitFor(view, "!!document.querySelector('.a2a-discovery')");
  assert.match(await view.cdp.evaluate("document.querySelector('.a2a-discovery').innerText"), /Synthetic A2A reviewer/);
  assert.match(await view.cdp.evaluate("document.querySelector('.a2a-discovery').innerText"), /Review changes/);
  await clickText(view, "保存连接", ".a2a-form"); await waitFor(view, "!document.querySelector('.a2a-form') && __a2aQA.connections.length === 1");
  const first = await view.cdp.evaluate("__a2aQA.calls.find(call => call.command === 'a2a_save_connection')");
  assert.equal(first.args.draft.auth.credential.action, "replace"); assert.equal(first.args.draft.auth.credential.value, "fixture-a2a-token");
  assert.match(first.args.rootPath, /^\/qa\/synthetic-project\//);
  assert.equal(await view.cdp.evaluate("JSON.stringify(Object.entries(localStorage)).includes('fixture-a2a-token')"), false);
  await click(view, '.a2a-map-node[data-kind="external"]');
  await waitFor(view, "!!document.querySelector('.a2a-inspect .a2a-row-actions')");
  await evidence(view, "a2a-project-external-desktop", ['.a2a-row-actions button']);
  await click(view, '.a2a-section button[aria-label="编辑 Synthetic remote reviewer"]');
  assert.equal(await view.cdp.evaluate("document.querySelector('#a2a-credentialAction').textContent.includes('保留已有凭据')"), true);
  assert.equal(await view.cdp.evaluate("!!document.querySelector('#a2a-secret')"), false);
  assert.equal(await view.cdp.evaluate("document.querySelector('.a2a-section').innerText.includes('fixture-a2a-token')"), false);
  await fill(view, "#a2a-name", "Renamed synthetic reviewer");
  await clickText(view, "保存连接", ".a2a-form"); await waitFor(view, "!document.querySelector('.a2a-form')");
  const retained = await view.cdp.evaluate("__a2aQA.calls.filter(call => call.command === 'a2a_save_connection').at(-1).args.draft.auth.credential");
  assert.deepEqual(retained, { action: "keep" });
  await click(view, '.a2a-section button[aria-label="编辑 Renamed synthetic reviewer"]');
  await choose(view, "a2a-credentialAction", "清除已有凭据"); await clickText(view, "保存连接", ".a2a-form");
  await waitFor(view, "!document.querySelector('.a2a-form') && !__a2aQA.connections[0].auth.hasCredential");
  await switchLanguage(view, "en"); assert.match(await englishPanel(view, ".a2a-section"), /Credential required/);
  await clickText(view, "Edit", ".a2a-section"); await choose(view, "a2a-authKind", "Header API-key");
  await fill(view, "#a2a-secret", "fixture-header-key"); await fill(view, "#a2a-headerName", "X-API-Key");
  await englishPanel(view, ".a2a-section");
  await resize(view, 640, 960);
  await view.cdp.evaluate("document.querySelector('.a2a-form-footer').scrollIntoView({block:'center'})");
  await evidence(view, "a2a-editor-640", ['.a2a-form button[type="submit"]']);
  await resize(view, 390, 900);
  await view.cdp.evaluate("document.querySelector('.a2a-form-footer').scrollIntoView({block:'center'})");
  await englishPanel(view, ".a2a-panel");
  await evidence(view, "a2a-editor-390", ['.a2a-form button[type="submit"]']);
  await clickText(view, "Save connection", ".a2a-form"); await waitFor(view, "!document.querySelector('.a2a-form') && __a2aQA.connections[0].auth.kind === 'apiKey'");
  await click(view, '.a2a-row-actions .a2a-button--danger'); await clickText(view, "Confirm deletion", ".a2a-confirm");
  await waitFor(view, "__a2aQA.connections.length === 0 && !document.querySelector('.a2a-confirm')");
  assert.match(await englishPanel(view, ".a2a-section"), /Add an A2A 1\.0 compatible Agent service/);
  await waitFor(view, "!document.querySelector('.a2a-panel__close').disabled");
  await press(view, "Escape"); await waitFor(view, "!document.querySelector('.a2a-panel')");
  assert.equal(await view.cdp.evaluate("document.activeElement === document.querySelector('.workbench-a2a')"), true);
  assert.equal(await view.cdp.evaluate("document.querySelector('.workbench').inert || document.querySelector('.sidebar-shell').inert"), false);
  await intact(view, baseline);
});

test("production A2A checks cancel the original native request and ignore a late result after opening a new editor", async t => {
  const { view, baseline } = await uiFixture(t, { nativeExtension });
  await add(view); await view.cdp.evaluate("__a2aQA.deferProbe = true");
  await clickText(view, "检测连接", ".a2a-form"); await waitFor(view, "__a2aQA.pending.size === 1");
  const checking = await view.cdp.evaluate("__a2aQA.calls.find(call => call.command === 'a2a_probe_connection')");
  await clickText(view, "停止检测", ".a2a-form"); await waitFor(view, "!document.querySelector('#a2a-name').matches(':disabled') && __a2aQA.cancelled.length === 1");
  const cancelled = await view.cdp.evaluate("__a2aQA.calls.find(call => call.command === 'a2a_cancel_request')");
  assert.deepEqual(cancelled.args, { rootPath: checking.args.rootPath, requestId: checking.args.requestId });
  await clickText(view, "取消", ".a2a-form"); await clickText(view, "新增连接", ".a2a-section");
  await fill(view, "#a2a-name", "Newer editor"); await fill(view, "#a2a-cardUrl", cardUrl);
  await view.cdp.evaluate(`__a2aQA.fulfill(${JSON.stringify(checking.args.requestId)})`);
  await view.cdp.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.a2a-discovery')"), false);
  assert.equal(await view.cdp.evaluate("document.querySelector('#a2a-name').value"), "Newer editor");
  await view.cdp.evaluate("__a2aQA.deferProbe = false");
  await clickText(view, "检测连接", ".a2a-form"); await waitFor(view, "!!document.querySelector('.a2a-discovery')");
  await clickText(view, "取消", ".a2a-form");
  await waitFor(view, "!document.querySelector('.a2a-form') && !document.querySelector('.a2a-panel__close').disabled");
  await intact(view, baseline);
});

test("production project A2A requires explicit cross-origin interface selection and shows check failures without saving", async t => {
  const { view, baseline } = await uiFixture(t, { nativeExtension });
  await add(view); await view.cdp.evaluate("__a2aQA.crossOrigin = true");
  await clickText(view, "检测连接", ".a2a-form"); await waitFor(view, "!!document.querySelector('.a2a-interface-choices')");
  assert.match(await view.cdp.evaluate("document.querySelector('.a2a-discovery [role=alert]').textContent"), /origin/);
  await clickText(view, "https://other.synthetic.invalid/a2a", ".a2a-interface-choices");
  assert.equal(await view.cdp.evaluate("document.querySelector('#a2a-interfaceUrl').value"), "https://other.synthetic.invalid/a2a");
  // Selecting an interface re-checks automatically; wait for the result and
  // for the form to become idle again before triggering the failure case.
  await waitFor(view, "!!document.querySelector('.a2a-selected-interface')");
  await waitFor(view, "document.querySelector('.a2a-form').innerText.includes('检测连接')");
  assert.equal(await view.cdp.evaluate("__a2aQA.calls.filter(call => call.command === 'a2a_save_connection').length"), 0);
  await view.cdp.evaluate("__a2aQA.probeError = {code:'A2A_HTTP_ERROR',message:'Synthetic unauthorized response',details:{httpStatus:401}}");
  await clickText(view, "检测连接", ".a2a-form"); await waitFor(view, "document.querySelector('.a2a-section > [role=alert]')?.textContent.includes('401')");
  assert.equal(await view.cdp.evaluate("__a2aQA.connections.length"), 0);
  await clickText(view, "取消", ".a2a-form"); await intact(view, baseline);
});

test("production local discovery shows actual readiness, isolates the project and retains reports across refresh failures", async t => {
  const { view, baseline } = await uiFixture(t, { nativeExtension });
  await a2a(view); await waitFor(view, "!document.querySelector('.a2a-spinner')");
  const root = await view.cdp.evaluate("document.querySelector('.a2a-project span').textContent");
  await view.cdp.evaluate(`__a2aQA.local = {agents:[
    {id:'local:ready-instance',name:'Local reviewer',rootPath:${JSON.stringify(root)},cardUrl:'http://127.0.0.1/private-card',interfaceUrl:null,revision:'ready-instance',auth:{kind:'bearer',headerName:null,hasCredential:true},local:{tabId:'reviewer-tab',agent:'claude',ready:true}},
    {id:'local:foreign',name:'Foreign Agent',rootPath:'/other-project',local:{tabId:'foreign-tab',agent:'codex',ready:true}}
  ],unsupported:[{tabId:'pi-tab',name:'Pi session',agent:'pi',reason:'adapterUnsupported'}]}`);
  await clickText(view, "刷新", ".a2a-section"); await waitFor(view, "document.querySelector('.a2a-map').textContent.includes('Local reviewer')");
  const labels = await view.cdp.evaluate("[...document.querySelectorAll('.a2a-map-node[data-kind]')].map(node => node.getAttribute('aria-label'))");
  assert.ok(labels.some(label => label.includes('Local reviewer') && label.includes('已接通')));
  assert.ok(labels.some(label => label.includes('Pi session') && label.includes('尚未接通')));
  assert.ok(!labels.some(label => label.includes('Foreign Agent')));
  assert.equal(await view.cdp.evaluate("document.querySelectorAll('.a2a-map-node[data-kind]').length"), 2);
  await click(view, '.a2a-map-node[aria-label*="Pi session"]');
  await waitFor(view, "!!document.querySelector('.a2a-inspect')");
  assert.match(await view.cdp.evaluate("document.querySelector('.a2a-inspect').textContent"), /尚无已验证的自动协作适配器/);
  await evidence(view, "a2a-project-local-desktop", ['.a2a-panel__close', '.a2a-map-node[data-kind="local"]']);
  await switchLanguage(view, "en");
  assert.match(await englishPanel(view, ".a2a-inspect"), /Not connected/);
  assert.match(await englishPanel(view, ".a2a-inspect"), /no verified automatic collaboration adapter/);
  assert.ok(await view.cdp.evaluate(`[...document.querySelectorAll('.a2a-map-node[data-kind="local"]')].some(node => (node.getAttribute('aria-label') ?? '').includes('Connected'))`));
  await resize(view, 390, 900);
  await evidence(view, "a2a-project-local-390", ['.a2a-panel__close', '.a2a-map-node[data-kind="local"]']);
  await view.cdp.evaluate("__a2aQA.local = {agents:[],unsupported:[{tabId:'reviewer-tab',name:'Reopened reviewer',agent:'claude',reason:'adapterNotReady'}]}");
  await clickText(view, "Refresh", ".a2a-section"); await waitFor(view, "document.querySelector('.a2a-map').textContent.includes('Reopened reviewer')");
  assert.doesNotMatch(await view.cdp.evaluate("document.querySelector('.a2a-map').textContent"), /Local reviewer/);
  await view.cdp.evaluate("__a2aQA.localError = {code:'A2A_OPERATION_FAILED',message:'Synthetic local discovery failure'}");
  await clickText(view, "Refresh", ".a2a-section"); await waitFor(view, "!!document.querySelector('.a2a-section > [role=alert]')");
  assert.match(await view.cdp.evaluate("document.querySelector('.a2a-map').textContent"), /Reopened reviewer/);
  assert.match(await englishPanel(view, ".a2a-section > [role=alert]"), /updated desktop host/);
  assert.equal(await view.cdp.evaluate("__a2aQA.calls.filter(call => ['a2a_save_connection','a2a_remove_connection'].includes(call.command)).length"), 0);
  await intact(view, baseline);
});

test("production A2A project navigation keeps saved connections separate when switching projects", async t => {
  const scopedNative = nativeExtension + `
    (() => {
      const first = JSON.parse(localStorage.getItem('belfry.workspace.v1')).tabs[0].project;
      const other = {...first, id:'second-a2a-project', name:'Second synthetic project', rootPath:'/qa/second-a2a-project', rootUri:'file:///qa/second-a2a-project'};
      localStorage.setItem('belfry.recent-projects.v1', JSON.stringify([first, other]));
      const previous = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
        if (command === 'project_open' && args.path === other.rootPath) {
          __productionQA.calls.push({command, args});
          return structuredClone(other);
        }
        return previous(command, args);
      };
    })();`;
  const { view, baseline } = await uiFixture(t, { nativeExtension: scopedNative });
  await add(view, "First project reviewer");
  await clickText(view, "保存连接", ".a2a-form"); await waitFor(view, "!document.querySelector('.a2a-form') && __a2aQA.connections.length === 1");
  const firstRoot = await view.cdp.evaluate("document.querySelector('.a2a-project span').textContent");
  await click(view, '.a2a-panel__close'); await waitFor(view, "!document.querySelector('.a2a-panel')");
  await click(view, '.project-trigger'); await clickText(view, 'Second synthetic project', '.popover--project');
  await waitFor(view, "document.querySelector('.project-trigger__name').textContent === 'Second synthetic project' && __productionQA.creates === 3");
  await a2a(view); await waitFor(view, "!document.querySelector('.a2a-spinner')");
  assert.doesNotMatch(await view.cdp.evaluate("document.querySelector('.a2a-map').textContent"), /First project reviewer/);
  assert.equal(await view.cdp.evaluate("document.querySelector('.a2a-map__side.is-external b').textContent"), "0");
  assert.equal(await view.cdp.evaluate("document.querySelector('.a2a-project span').textContent"), "/qa/second-a2a-project");
  await add(view, "Second project reviewer"); await clickText(view, "保存连接", ".a2a-form");
  await waitFor(view, "!document.querySelector('.a2a-form') && __a2aQA.connections.length === 2");
  const saves = await view.cdp.evaluate("__a2aQA.calls.filter(call => call.command === 'a2a_save_connection').map(call => call.args.rootPath)");
  assert.deepEqual(saves, [firstRoot, "/qa/second-a2a-project"]);
  await click(view, '.a2a-map-node[data-kind="external"]');
  await waitFor(view, "document.querySelectorAll('.a2a-link-card').length === 1");
  assert.match(await view.cdp.evaluate("document.querySelector('.a2a-inspect').textContent"), /Second project reviewer/);
  await intact(view, baseline, 1);
});

test("production task panel shows exact-generation explicit input and artifact previews without completing the business task", async t => {
  const { view, baseline } = await uiFixture(t, { nativeExtension });
  await view.cdp.evaluate(`(() => {
    __productionQA.tasks = [{id:'a2a-business-task',shortId:'a2a-task',fromLabel:'Planner',toLabel:'Reviewer',instruction:'Review explicit reports',state:'dispatched',hop:1,createdAt:Date.now(),result:null}];
    const report = {taskRef:{kind:'direct_task',roomId:null,id:'a2a-business-task',generation:1},protocolTaskId:'protocol-task',state:'TASK_STATE_INPUT_REQUIRED',source:'localA2A',text:'Which branch should I review?',textTruncated:true,artifacts:[{artifactId:'draft',name:'Draft review',text:'Partial findings',truncated:true}]};
    __a2aQA.reports = [report,{...report,taskRef:{...report.taskRef,generation:0},text:'OLD GENERATION MUST NOT APPEAR',state:'TASK_STATE_COMPLETED'}];
  })()`);
  await menuAction(view, "会话协作", 'button[title="会话协作"]');
  await waitFor(view, "document.querySelector('.a2a-task-report')?.textContent.includes('Which branch')");
  const text = await view.cdp.evaluate("document.querySelector('.collab-panel').textContent");
  assert.match(text, /本地 A2A · 显式回报/); assert.match(text, /等待补充信息/); assert.match(text, /预览已截断/);
  assert.doesNotMatch(text, /OLD GENERATION/);
  assert.equal(await view.cdp.evaluate("__productionQA.tasks[0].state"), "dispatched");
  assert.equal(await view.cdp.evaluate("document.querySelector('.a2a-task-report details').open"), true);
  await evidence(view, "a2a-explicit-input-preview", ['button[aria-label="关闭协作面板"]']);
  await view.cdp.evaluate("__a2aQA.reportError={code:'A2A_LOCAL_UNAVAILABLE',message:'Synthetic refresh failure'}");
  await waitFor(view, "!!document.querySelector('.a2a-report-error')");
  assert.match(await view.cdp.evaluate("document.querySelector('.collab-panel').textContent"), /Which branch/);
  assert.match(await view.cdp.evaluate("document.querySelector('.a2a-report-error').textContent"), /预览可能已过期/);
  assert.equal(await view.cdp.evaluate("__a2aQA.calls.filter(call=>!['a2a_local_task_snapshot'].includes(call.command)).length"), 0);
  await intact(view, baseline);
});
