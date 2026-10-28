import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, click, waitFor } from "../../components/lazy/testing/browserFixture.mjs";
import { clickText, setValue, evidence, resize, uiFixture, menuAction, intact } from "../../components/lazy/testing/production-uiFixture.mjs";

const PAGE = "src/git/testing/review.html";
const line = '.git-line--add .git-review-line';
const comment = '.git-review textarea';
const send = '.git-review__send';
async function openDiff(view, path = '示例 文件.ts') {
  await clickText(view, path, '.git-file-group');
  await waitFor(view, `!!document.querySelector('${line}')`);
}
async function start(t) {
  const { view } = await browserFixture(t, PAGE);
  await openDiff(view); await click(view, line);
  await waitFor(view, `document.activeElement === document.querySelector('${comment}')`);
  return view;
}
const health = async (view) => assert.deepEqual(await view.cdp.evaluate('__reviewQA.errors'), []);

test('review keeps drafts and delivery receipts across file/panel switches and waits for confirmed submission', { timeout: 60_000 }, async t => {
  const view = await start(t);
  await setValue(view, comment, '请处理空数组，并补充测试。');
  await openDiff(view, 'another.ts');
  assert.equal(await view.cdp.evaluate(`!!document.querySelector('${comment}')`), false);
  await openDiff(view);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${comment}').value`), '请处理空数组，并补充测试。');
  await click(view, '#toggle-review'); await click(view, '#toggle-review'); await openDiff(view);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${comment}').value`), '请处理空数组，并补充测试。');
  await view.cdp.evaluate(`document.querySelector('${comment}').dispatchEvent(new KeyboardEvent('keydown', {
    key:'Enter',ctrlKey:true,isComposing:true,bubbles:true,cancelable:true
  }))`);
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.git-review__receipt')"), false,
    'IME composition must not submit feedback');
  await view.cdp.evaluate(`document.querySelector('${send}').click();document.querySelector('${send}')?.click()`);
  await waitFor(view, "!!document.querySelector('.git-review__receipt.is-sending')");
  assert.equal(await view.cdp.evaluate('__reviewQA.writes.length'), 1);
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.git-review__receipt.is-submitted')"), false);
  await view.cdp.evaluate("__reviewQA.complete('submitted')");
  await waitFor(view, "!!document.querySelector('.git-review__receipt.is-submitted')");
  const written = await view.cdp.evaluate('__reviewQA.writes[0]');
  assert.equal(written.id, 'reviewer');
  const payload = JSON.parse(written.text.split('\n\n').at(-1));
  assert.equal(payload.feedback, '请处理空数组，并补充测试。');
  assert.equal(payload.file, 'src/示例 文件.ts');
  assert.equal(payload.selectedLine.newLine, 3);
  await clickText(view, '查看会话', '.git-review');
  assert.deepEqual(await view.cdp.evaluate('__reviewQA.activations'), ['reviewer']);
  await click(view, '#toggle-review'); await click(view, '#toggle-review'); await openDiff(view);
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.git-review__receipt.is-submitted')"), true);
  await health(view);
});

test('review filters recipients, queues during permission prompts, allows cancellation and dispatches on idle', { timeout: 60_000 }, async t => {
  const view = await start(t);
  await setValue(view, comment, '检查边界条件');
  await click(view, '[aria-label="接收反馈的 Agent"]');
  const choices = await view.cdp.evaluate("[...document.querySelectorAll('[role=option]')].map(el=>el.textContent)");
  assert.equal(choices.length, 2);
  assert.ok(choices.every(text => !/other-worktree|shell/.test(text)));
  await clickText(view, 'builder', '[role=listbox]');
  await view.cdp.evaluate("__reviewQA.setActivity('builder','awaiting-choice')");
  await click(view, send);
  await waitFor(view, "!!document.querySelector('.git-review__receipt.is-queued')");
  assert.equal(await view.cdp.evaluate('__reviewQA.writes.length'), 0);
  await clickText(view, '取消排队', '.git-review');
  await waitFor(view, "!!document.querySelector('.git-review__receipt.is-cancelled')");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${comment}').value`), '检查边界条件');
  await view.cdp.evaluate("__reviewQA.setActivity('builder','idle')");
  await waitFor(view, "__reviewQA.tabs.find(tab=>tab.id==='builder').activity==='idle'");
  assert.equal(await view.cdp.evaluate('__reviewQA.writes.length'), 0);
  await view.cdp.evaluate("__reviewQA.setActivity('builder','talking')");
  await waitFor(view, "__reviewQA.tabs.find(tab=>tab.id==='builder').activity==='talking'");
  await click(view, send);
  await waitFor(view, "!!document.querySelector('.git-review__receipt.is-queued')");
  await view.cdp.evaluate("__reviewQA.setActivity('builder','idle')");
  await waitFor(view, '__reviewQA.writes.length===1');
  assert.equal(await view.cdp.evaluate('__reviewQA.writes[0].id'), 'builder');
  await view.cdp.evaluate("__reviewQA.complete('failed')");
  await waitFor(view, "!!document.querySelector('.git-review__receipt.is-attention')");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.git-review__receipt.is-submitted')"), false);
  await health(view);
});

test('review rejects stale disk content, failed reads and a recipient removed during preflight without losing feedback', { timeout: 60_000 }, async t => {
  const view = await start(t);
  await setValue(view, comment, '保留这段修改意见');
  await view.cdp.evaluate("__reviewQA.patch=__reviewQA.patch.replace('items.at(0)','items.at(1)')");
  await click(view, send);
  await waitFor(view, "document.querySelector('.git-review__error')?.textContent.includes('磁盘上变化')");
  assert.equal(await view.cdp.evaluate('__reviewQA.writes.length'), 0);
  await click(view, 'button[aria-label="刷新 Diff"]');
  await waitFor(view, "!!document.querySelector('.git-review__warning')");
  await click(view, line);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${comment}').value`), '保留这段修改意见');
  await view.cdp.evaluate('__reviewQA.readFailure=true');
  await click(view, send);
  await waitFor(view, "document.querySelector('.git-review__error')?.textContent.includes('Synthetic disk unavailable')");
  await view.cdp.evaluate('__reviewQA.readFailure=false;__reviewQA.holdRead=true');
  await click(view, send);
  await waitFor(view, "!!document.querySelector('.git-review__receipt.is-checking')");
  await view.cdp.evaluate("__reviewQA.remove('reviewer')");
  await waitFor(view, "!__reviewQA.tabs.some(tab=>tab.id==='reviewer')");
  await view.cdp.evaluate('__reviewQA.releaseRead()');
  await waitFor(view, "document.querySelector('.git-review__error')?.textContent.includes('接收会话已不可用')");
  assert.equal(await view.cdp.evaluate('__reviewQA.writes.length'), 0);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${comment}').value`), '保留这段修改意见');
  await health(view);
});

test('review actions remain reachable in both themes and a narrow panel', { timeout: 60_000 }, async t => {
  const view = await start(t);
  await setValue(view, comment, '处理空数组');
  for (const mode of ['dark', 'light']) {
    await view.cdp.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(mode)}`);
    for (const width of [720, 390]) {
      await resize(view, width, 700);
      await waitFor(view, `(() => {
        const viewport=document.querySelector('.git-diff__scroll');
        const bounds=viewport.getBoundingClientRect(), row=document.querySelector('.is-review-selected').getBoundingClientRect();
        return row.top>=bounds.top-1 && row.bottom<=bounds.top+viewport.clientHeight+1;
      })()`);
      await evidence(view, `git-review-${mode}-${width}`, [comment, send, '[aria-label="接收反馈的 Agent"]']);
    }
  }
  await health(view);
});

test('production App sends review feedback through its real prompt queue and xterm input without remounting terminals', { timeout: 60_000 }, async t => {
  const nativeExtension = `(() => {
    const saved=JSON.parse(localStorage.getItem('belfry.workspace.v1'));
    Object.assign(saved.tabs[0],{kind:'codex',profileId:'agent:codex',agentName:'reviewer'});
    localStorage.setItem('belfry.workspace.v1',JSON.stringify(saved));
  })();`;
  const { view, baseline } = await uiFixture(t, { nativeExtension });
  await menuAction(view, '文件与 Git 改动', 'button[aria-label="文件预览"]');
  await click(view, 'button[title="查看 Git 变更"]');
  await click(view, '.git-file__select');
  await waitFor(view, `!!document.querySelector('${line}')`);
  await click(view, line); await setValue(view, comment, 'production-review-feedback');
  await click(view, send);
  await waitFor(view, "!!document.querySelector('.git-review__receipt.is-submitted')");
  const writes = await view.cdp.evaluate("__productionQA.writes.map(call=>({id:call.sessionId,text:new TextDecoder().decode(new Uint8Array(call.bytes))}))");
  assert.ok(writes.some(call=>call.id==='ui-terminal-0-pty' && call.text.includes('production-review-feedback')));
  assert.ok(!writes.some(call=>call.id==='ui-terminal-1-pty'));
  await evidence(view, 'git-review-production-sent', ['button[aria-label="关闭 Git 面板"]']);
  await intact(view, baseline);
});
