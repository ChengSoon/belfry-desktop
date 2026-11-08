import assert from "node:assert/strict";
import test from "node:test";
import { productionFixture, assertTerminalIntact, click, waitFor } from "./productionFixture.mjs";
import { clickText, resize } from "./production-uiFixture.mjs";
import { englishPanel, openAction } from "./i18n-browser-support.mjs";
import { fill } from "../../../../scripts/plugin-tests/market-ui-support.mjs";

const nativeSource = `(() => {
  localStorage.setItem('belfry.locale.v1', 'en');
  const invoke = __TAURI_INTERNALS__.invoke;
  const at = Date.UTC(2026, 10, 8) / 1000;
  const entry = { name:'sample.ts', relativePath:'sample.ts', kind:'file', size:1234, modifiedAt:at };
  const handlers = {
    history_search: () => ({ hits:[{ session:{ agent:'claude', id:'history-en', title:'Investigate terminal delivery', cwd:'/qa/panel-project', startedAt:at, lastActiveAt:at, sessionRef:{agent:'claude',id:'history-en'} }, snippet:'Keep the draft after sending.' }], projects:['/qa/panel-project'], scannedFiles:1234, indexedFiles:1, skippedFiles:1, skippedLines:2 }),
    history_detail_open: ({request}) => ({ readerId:request.readerId, page:0, hasMore:false, scannedBytes:1234, totalBytes:1234, skippedLines:1, note:null, entries:[{ id:'entry-en', role:'assistant', timestamp:at, text:'A synthetic historical response.', tools:[], omittedBlocks:2, truncated:true }] }),
    history_detail_close: () => null,
    usage_analytics: () => ({ rows:[{ agent:'claude', model:'sample-model', day:at, projectRoot:'/qa/panel-project', projectName:'panel-qa', tokens:{input:1000000,cachedInput:250000,cacheWrite:0,output:1000}, requests:2 }], quotas:[], scannedFiles:1234, skippedFiles:1, undatedRecords:1, diagnostics:{skippedLines:2}, windowDays:30, projectRoot:null, startAt:at-29*86400, endAt:at+86400, generatedAt:at }),
    project_list_directory: () => ({ relativePath:'', entries:[entry], truncated:true }),
    project_read_file: () => ({ ...entry, content:'export const sample = 1;', language:'typescript', binary:false, truncated:true }),
  };
  __TAURI_INTERNALS__.invoke = (command,args) => {
    if (!handlers[command]) return invoke(command,args);
    __productionQA.calls.push({command,args});
    return Promise.resolve(handlers[command](args));
  };
})();`;

test('English history search and details remain readable and usable at 720x480', async t => {
  const {view} = await productionFixture(t, {nativeSource});
  const token = await view.cdp.evaluate('__productionQA.token');
  await resize(view, 720, 480);
  await openAction(view, 'session history');
  await waitFor(view, "!!document.querySelector('.history-item__main')");
  assert.match(await englishPanel(view, '.history-panel'), /1,234/);
  await fill(view, '.history-search-input input', 'delivery');
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'history_search' && call.args.request.query.text === 'delivery')");
  await click(view, '.history-item__main');
  await waitFor(view, "document.querySelector('.history-detail__body')?.textContent.includes('synthetic historical response')");
  await englishPanel(view, '.history-panel');
  await click(view, 'button[title="Back to history"]');
  await waitFor(view, "!!document.querySelector('.history-item__main')");
  await click(view, 'button[title="Close history"]');
  await waitFor(view, "!document.querySelector('.history-panel')");
  await assertTerminalIntact(view, token);
});

test('English usage and file preview fit the minimum window', async t => {
  const {view} = await productionFixture(t, {nativeSource});
  const token = await view.cdp.evaluate('__productionQA.token');
  await resize(view, 720, 480);
  await openAction(view, 'usage and quotas');
  await waitFor(view, "!!document.querySelector('.usage-insight-summary strong')");
  assert.match(await englishPanel(view, '.usage-panel'), /1\.3M/);
  await clickText(view, 'Quotas and methodology', '.usage-panel');
  await englishPanel(view, '.usage-panel');
  await click(view, 'button[aria-label="Refresh usage"]');
  await waitFor(view, "__productionQA.calls.filter(call => call.command === 'usage_analytics').length >= 2");
  await click(view, 'button[aria-label="Close usage"]');
  await waitFor(view, "!document.querySelector('.usage-panel')");
  await openAction(view, 'open file preview');
  await waitFor(view, "!!document.querySelector('.file-preview__entry')");
  await click(view, '.file-preview__entry');
  await waitFor(view, "document.querySelector('.file-preview__content')?.textContent.includes('export const sample')");
  await englishPanel(view, '.file-preview-panel');
  await click(view, 'button[title="Close file preview"]');
  await waitFor(view, "!document.querySelector('.file-preview-panel')");
  await assertTerminalIntact(view, token);
});
