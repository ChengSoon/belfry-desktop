import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import { productionFixture, click, press, waitFor } from "./productionFixture.mjs";

/*
 * 协作收件箱真实页面验证：未经改写的生产构建 + 可控原生 IPC。
 * 模拟后台只按 T62 implementation-contract.md 的命令/字段返回，验证前端运行时与只读界面：
 * - 忙时多条来信只形成一个提醒；终端就绪（idle + 输入区空）后整批一次写入，带 guard 且序号连续。
 * - 用户在 prepare 后抢先输入：abort，不写入。
 * - 只读界面：会话列表 → 消息详情 → 返回；无投递/合并/撤回/答复按钮；1440 与 720x480 可点。
 */
const ROOT = "/qa/panel-project";
const SHOTS = process.env.BELFRY_INBOX_SHOTS;

const nativeSource = `(() => {
  const w = JSON.parse(localStorage.getItem('belfry.workspace.v1'));
  const base = w.tabs[0];
  w.tabs.push({ ...base, id: 'agent-backend', kind: 'codex', profileId: 'agent:codex', title: '后端', customTitle: '后端', agentName: '后端', collaborationMode: true });
  localStorage.setItem('belfry.workspace.v1', JSON.stringify(w));

  const now = Date.now();
  const st = (code, params = {}) => ({ code, params });
  const recipient = { id: 'r-be', sessionKey: 'sk-be', projectRoot: '${ROOT}', tabId: 'agent-backend', roomId: 'room', memberId: 'm-be', name: '后端', agent: 'codex' };
  const actor = (name) => ({ id: 'a-' + name, name, tabId: null, memberId: null });
  const msg = (id, at, by, text, extra = {}) => ({ id, messageId: 'o-' + id, revision: 1, source: { kind: 'room', roomId: 'room', name: 'Belfry项目', messageId: 'o-' + id },
    recipient, topicId: 'fields', class: 'discussion', by: actor(by), createdAt: now - at * 60000, text, attachments: [], replyTo: null,
    questions: [], replies: [], deliveryPhase: 'pending', deliveryStatus: st('queue_turn'), handlingStatus: st('unknown_handling'), waitingReason: st('turn_busy'), ...extra });
  const inbox = window.__inboxQA = {
    calls: [], aborts: 0, batches: [], receipts: [], guarded: [], userWrites: 0, inputRevision: 0, offers: new Set(),
    messages: [
      msg('e1', 30, '项目经理', '调整接口返回值：分页结构统一为 items + total。', { class: 'task_assignment', deliveryPhase: 'submitted', deliveryStatus: st('submitted', { batchId: 'b0' }), handlingStatus: st('processing'), waitingReason: null }),
      msg('e2', 20, '前端', '两个问题想先确认。', { deliveryPhase: 'submitted', deliveryStatus: st('submitted', { batchId: 'b0' }), waitingReason: null,
        questions: [{ id: 'q1', text: '页码从 0 还是从 1 开始？', state: 'replied', replyMessageIds: ['o-r1'], legacy: false }, { id: 'q2', text: '排序字段沿用 sort 还是 orderBy？', state: 'open', replyMessageIds: [], legacy: false }],
        replies: [{ messageId: 'o-r1', by: actor('后端'), createdAt: now - 18 * 60000, text: '从 1 开始。', answers: ['q1'] }] }),
      msg('e3', 9, '项目经理', '补充登录接口的边界测试并记录验证结果。', { class: 'task_assignment', waitingReason: st('previous_task', { task: 'T60 调整接口返回值' }) }),
      msg('e4', 6, '前端', 'total 是总记录数还是当前页条数？', { questions: [{ id: 'q3', text: 'total 是总记录数还是当前页条数？', state: 'open', replyMessageIds: [], legacy: false }] }),
      msg('e5', 4, '项目经理', '约束：保留已有字段名，兼容当前客户端。', {
        replyTo: 'o-other-session', replyPreview: { messageId: 'o-other-session', by: actor('后端'), createdAt: now - 11 * 60000,
          text: '请确认是否保留已有字段名。', answers: [] },
      }),
    ],
  };
  const sessions = () => {
    const pending = inbox.messages.filter(m => m.deliveryPhase === 'pending' && m.class !== 'fyi');
    const awaiting = inbox.messages.filter(m => m.deliveryPhase === 'submitted').reduce((n, m) => n + m.questions.filter(q => q.state === 'open').length, 0);
    const reasons = new Set(pending.map(m => m.waitingReason?.code));
    const summary = pending.length ? (reasons.size > 1 ? st('mixed_waiting') : pending[0].waitingReason) : awaiting ? st('waiting_reply') : st('empty');
    const last = inbox.messages.at(-1);
    return [
      { sessionKey: 'sk-be', tabId: 'agent-backend', name: '后端', agent: 'codex', projectRoot: '${ROOT}', runtimeAvailability: 'busy', summaryStatus: summary,
        pendingCount: pending.length, awaitingReplyCount: awaiting, lastMessagePreview: last.text, lastMessageAt: last.createdAt, oldestPendingAt: null },
      { sessionKey: 'sk-qa', tabId: 'agent-qa', name: '测试', agent: 'codex', projectRoot: '${ROOT}', runtimeAvailability: 'offline', summaryStatus: st('target_offline'),
        pendingCount: 2, awaitingReplyCount: 0, lastMessagePreview: '登录接口的错误码表已更新，回归时以新表为准。', lastMessageAt: now - 14 * 60000, oldestPendingAt: null },
    ];
  };
  const take = () => inbox.messages.filter(m => m.deliveryPhase === 'pending' && m.class === 'discussion');
  const invoke = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command.startsWith('collab_inbox_')) inbox.calls.push(command);
    const req = args?.request;
    switch (command) {
      case 'collab_inbox_capabilities': return { schemaVersion: 1, capabilities: ['collaboration-inbox-v1'], enabled: false };
      case 'collab_inbox_activate': inbox.activated = true; return { schemaVersion: 1, capabilities: ['collaboration-inbox-v1'], enabled: true };
      case 'collab_inbox_sessions': return { schemaVersion: 1, revision: 1, generatedAt: Date.now(), sessions: args.projectRoot === '${ROOT}' ? sessions() : [], loadError: null };
      case 'collab_inbox_messages': return { schemaVersion: 1, revision: 1, messages: args.sessionKey === 'sk-be' ? structuredClone(inbox.messages) : [], nextCursor: null, loadError: null };
      case 'collab_inbox_pending': return { revision: 1, recipients: take().length ? [{ sessionKey: 'sk-be', tabId: 'agent-backend', projectRoot: '${ROOT}', pendingCount: take().length }] : [] };
      case 'collab_inbox_bind_target': return { ...req, targetEpoch: 'e1', inputRevision: inbox.inputRevision };
      case 'collab_inbox_offer': {
        if (req.binding.inputRevision !== inbox.inputRevision) throw { code: 'STALE_OFFER', message: 'input changed' };
        if (!(req.running && req.idle && req.composerEmpty && !req.awaitingInput && req.promptQueueEmpty)) throw { code: 'NOT_READY', message: 'not ready' };
        inbox.offers.add(req.offerId); return { binding: req.binding, offerId: req.offerId, expiresAt: Date.now() + 5000 };
      }
      case 'collab_inbox_revoke_offer': inbox.offers.delete(req.offerId); return null;
      case 'collab_inbox_prepare': {
        const items = take();
        if (!items.length) return { batch: null, blocker: st('empty') };
        const payload = '[Belfry 收件箱] 议题 fields · ' + items.length + ' 条\\n' + items.map(m => '#' + m.messageId + ' ' + m.by.name + '：' + m.text).join('\\n');
        const batch = { id: 'b' + (inbox.batches.length + 1), attemptId: 'att', revision: 1, sequence: 1, recipient, targetEpoch: 'e1', terminalSessionId: 'agent-backend-pty',
          topicId: 'fields', entryIds: items.map(m => m.id), messageIds: items.map(m => m.messageId), payload, payloadHash: 'h' + payload.length, contentMode: 'full',
          phase: 'prepared', preparedAt: Date.now(), leaseExpiresAt: Date.now() + 5000 };
        items.forEach(m => { m.deliveryPhase = 'prepared'; m.deliveryStatus = st('prepared', { batchId: batch.id }); m.waitingReason = null; });
        inbox.batches.push(batch); inbox.prepareHook?.(); return { batch, blocker: null };
      }
      case 'collab_inbox_abort_prepared': {
        inbox.aborts++;
        const b = inbox.batches.find(x => x.id === req.batchId);
        inbox.messages.filter(m => b.entryIds.includes(m.id)).forEach(m => { m.deliveryPhase = 'pending'; m.deliveryStatus = st('queue_turn'); m.waitingReason = st('turn_busy'); });
        return { ...b, phase: 'aborted' };
      }
      case 'collab_inbox_begin_submit': {
        const b = inbox.batches.find(x => x.id === req.batch.batchId);
        if (!inbox.offers.has(req.offer.offerId)) throw { code: 'STALE_OFFER', message: 'offer revoked' };
        inbox.messages.filter(m => b.entryIds.includes(m.id)).forEach(m => { m.deliveryPhase = 'submitting'; m.deliveryStatus = st('submitting', { batchId: b.id }); });
        return { batch: { ...b, sequence: 2, phase: 'submitting' }, writeGuard: { batchId: b.id, attemptId: b.attemptId, token: 'guard-' + b.id, ownerId: req.offer.binding.ownerId, targetEpoch: 'e1', inputRevision: inbox.inputRevision } };
      }
      case 'collab_inbox_receipt': {
        inbox.receipts.push(req);
        const b = inbox.batches.find(x => x.id === req.batchId);
        inbox.messages.filter(m => b.entryIds.includes(m.id)).forEach(m => {
          m.deliveryPhase = req.phase; m.deliveryStatus = st(req.phase, { batchId: b.id });
        });
        return { ...b, phase: req.phase };
      }
      case 'terminal_write': {
        const text = new TextDecoder().decode(new Uint8Array(args.bytes));
        if (args.inboxGuard) {
          inbox.guarded.push({ token: args.inboxGuard.token, sequence: args.writeSequence, text });
          if (args.writeSequence === 1 && inbox.queryDuringPaste) {
            inbox.expectedDsr = true;
            window.__productionQA.output('agent-backend-pty', '\\x1b[6n');
          }
        } else if (args.sessionId === 'agent-backend-pty') {
          if (inbox.expectedDsr && /^\\x1b\\[\\d+;\\d+R$/.test(text)) { inbox.expectedDsr = false; inbox.dsr = text; }
          else { inbox.userWrites++; inbox.inputRevision++; inbox.offers.clear(); }
        }
        return invoke(command, args);
      }
    }
    return invoke(command, args);
  };
})();`;

const PANEL = 'button[title="会话协作"]';
// 只给 Agent 终端“画屏幕”（模拟 PTY 输出），不经过 terminal_write，不算用户输入。
function emit(text) { window.__productionQA.output('agent-backend-pty', text); }

async function shot(view, name) {
  if (!SHOTS) return;
  await waitFor(view, "document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity)");
  await mkdir(SHOTS, { recursive: true });
  const { data } = await view.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${SHOTS}/${name}.png`, Buffer.from(data, "base64"));
}
async function openInbox(view) {
  if (!await view.cdp.evaluate("!!document.querySelector('.collab-panel')")) await click(view, PANEL);
  await waitFor(view, "!!document.querySelector('.inbox-session[data-session=sk-be]')");
}

test("收件箱：只读会话列表与消息详情，1440 与 720x480 可点、可返回", { timeout: 60_000 }, async (t) => {
  const { view } = await productionFixture(t, { nativeSource, terminalCount: 2 });
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(view, "__inboxQA.activated === true");
  await openInbox(view);
  const row = await view.cdp.evaluate("document.querySelector('.inbox-session[data-session=sk-be]').innerText");
  assert.match(row, /后端/); assert.match(row, /codex/);
  assert.match(row, /部分消息等待投递/, "协商等轮次 + 任务等交差 → 混合原因");
  assert.match(row, /3 条等待投递 · 1 个问题待回复/);
  assert.match(await view.cdp.evaluate("document.querySelector('.inbox-session[data-session=sk-qa]').innerText"), /等待成员上线/);
  await shot(view, "1440-inbox-sessions");

  await click(view, ".inbox-session[data-session=sk-be]");
  await waitFor(view, "document.querySelectorAll('.inbox-message').length === 5");
  const detail = await view.cdp.evaluate("document.querySelector('.inbox--detail').innerText");
  assert.match(detail, /等待上一任务完成 · T60 调整接口返回值/);
  assert.match(detail, /等待成员结束当前轮次/);
  assert.match(detail, /已回复：从 1 开始。/);
  assert.match(detail, /待回复/);
  assert.match(detail, /尚未送达/);
  assert.match(detail, /成员已确认处理/);
  assert.match(detail, /回复 后端：请确认是否保留已有字段名。/, "被引用原文不在当前页时仍显示后端提供的原文预览");
  const labels = await view.cdp.evaluate("[...document.querySelectorAll('.collab-panel button')].filter(b => b.offsetParent).map(b => b.innerText.trim())");
  for (const word of ["投递", "合并", "撤回", "暂缓", "答复", "重发", "确认已提交", "放弃"]) {
    assert.ok(!labels.some((label) => label.includes(word)), `收件箱不应出现「${word}」按钮：${labels}`);
  }
  await shot(view, "1440-inbox-detail");

  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.inbox--detail') && document.activeElement?.dataset?.session === 'sk-be'");

  await view.bounds({ x: 0, y: 0, width: 720, height: 480 });
  await openInbox(view);
  await shot(view, "720x480-inbox-sessions");
  await click(view, ".inbox-session[data-session=sk-be]");
  await waitFor(view, "!!document.querySelector('.inbox--detail .inbox-message')");
  await shot(view, "720x480-inbox-detail");
  assert.equal(await view.cdp.evaluate("document.documentElement.scrollWidth > innerWidth"), false, "720 宽无横向溢出");
  await click(view, ".inbox-back");
  await waitFor(view, "!!document.querySelector('.inbox-session[data-session=sk-be]')");
  await click(view, ".inbox-search input");
  await view.send("Input.insertText", { text: "测试" });
  await waitFor(view, "document.querySelectorAll('.inbox-session').length === 1 && !!document.querySelector('[data-session=sk-qa]')");
  await view.send("Input.insertText", { text: "不存在" });
  await waitFor(view, "document.querySelector('.inbox-empty')?.textContent.includes('没有匹配的会话')");
  assert.deepEqual(await view.cdp.evaluate("__productionQA.errors"), []);
});

test("收件箱运行时：就绪后整批一次带 guard 写入；用户抢先输入则 abort 不写", { timeout: 60_000 }, async (t) => {
  const { view } = await productionFixture(t, { nativeSource, terminalCount: 2 });
  await waitFor(view, "__inboxQA.activated === true");
  // Agent 正在工作：不应 offer。
  await view.cdp.evaluate(`(${emit.toString()})('\\x1b[2J\\x1b[H• Working (Esc to interrupt)\\r\\n')`);
  await new Promise((done) => setTimeout(done, 2_000));
  assert.equal(await view.cdp.evaluate("__inboxQA.calls.includes('collab_inbox_offer')"), false, "忙时不 offer");
  assert.equal(await view.cdp.evaluate("__inboxQA.batches.length"), 0);

  // 用户在 prepare 之后抢先输入：前端应 abort，且不写入任何 guarded 字节。
  // 与真实键入相同的入口：Agent 终端输入框上的 beforeinput（前端输入代次 +1），以及不带 guard 的写入（原生代次 +1）。
  await view.cdp.evaluate(`__inboxQA.prepareHook = () => { __inboxQA.prepareHook = null;
    const host = document.querySelectorAll('.xterm')[1].querySelector('.xterm-helper-textarea');
    host.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: 'x', inputType: 'insertText' }));
    window.__TAURI_INTERNALS__.invoke('terminal_write', { sessionId: 'agent-backend-pty', bytes: [120], inboxGuard: null, writeSequence: null }); };`);
  await view.cdp.evaluate(`(${emit.toString()})('\\x1b[?2004h\\x1b[2J\\x1b[H› \\r\\n  ? for shortcuts\\r\\n')`);
  await waitFor(view, "__inboxQA.aborts >= 1 || __inboxQA.guarded.length > 0", 15_000);
  assert.equal(await view.cdp.evaluate("__inboxQA.guarded.length"), 0, "抢先输入后不得写入");
  assert.ok(await view.cdp.evaluate("__inboxQA.aborts") >= 1);

  // 再次就绪：整批一次写入，粘贴与回车都带同一 guard，序号 1、2 连续；回执 submitted，sequence = batch.sequence + 1。
  await view.cdp.evaluate(`(${emit.toString()})('\\x1b[?2004h\\x1b[2J\\x1b[H› \\r\\n  ? for shortcuts\\r\\n')`);
  await waitFor(view, "__inboxQA.receipts.length === 1", 20_000);
  const guarded = await view.cdp.evaluate("__inboxQA.guarded");
  assert.deepEqual(guarded.map((w) => w.sequence), [1, 2]);
  assert.ok(guarded.every((w) => w.token === guarded[0].token));
  assert.match(guarded[0].text, /议题 fields · 2 条/);
  assert.match(guarded[0].text, /total 是总记录数/);
  assert.match(guarded[0].text, /保留已有字段名/);
  assert.doesNotMatch(guarded[0].text, /边界测试/, "等交差的新任务不随协商一起送出");
  assert.equal(guarded[1].text, "\r");
  assert.deepEqual(await view.cdp.evaluate("__inboxQA.receipts.map(r => [r.phase, r.sequence])"), [["submitted", 3]]);
  assert.equal(await view.cdp.evaluate("__inboxQA.batches.filter(b => b.id !== 'b0').length"), 2, "第一次 abort、第二次送达，没有第三批");
  await new Promise((done) => setTimeout(done, 2_000));
  assert.equal(await view.cdp.evaluate("__inboxQA.guarded.length"), 2, "送达后不重复写入");
  assert.equal(await view.cdp.evaluate("__productionQA.calls.some(c => c.command === 'collab_pending_tasks')"), false, "旧投递路径没有启动");
  assert.deepEqual(await view.cdp.evaluate("__productionQA.errors"), []);
});

test("收件箱运行时：原生侧先收到用户写入（前端没看到）时，begin 被拒，不写入", { timeout: 60_000 }, async (t) => {
  const { view } = await productionFixture(t, { nativeSource, terminalCount: 2 });
  await waitFor(view, "__inboxQA.activated === true");
  await view.cdp.evaluate(`(${emit.toString()})('\\x1b[2J\\x1b[H• Working (Esc to interrupt)\\r\\n')`);
  // 只推进原生输入代次并撤销 offer（模拟另一窗口/外部输入），不触发前端输入事件。
  await view.cdp.evaluate(`__inboxQA.prepareHook = () => { __inboxQA.prepareHook = null;
    window.__TAURI_INTERNALS__.invoke('terminal_write', { sessionId: 'agent-backend-pty', bytes: [120], inboxGuard: null, writeSequence: null }); };`);
  await view.cdp.evaluate(`(${emit.toString()})('\\x1b[?2004h\\x1b[2J\\x1b[H› \\r\\n  ? for shortcuts\\r\\n')`);
  await waitFor(view, "__inboxQA.calls.includes('collab_inbox_begin_submit')", 15_000);
  await new Promise((done) => setTimeout(done, 1_000));
  assert.equal(await view.cdp.evaluate("__inboxQA.guarded.length"), 0, "begin 被拒后不得写入");
  assert.equal(await view.cdp.evaluate("__inboxQA.receipts.length"), 0, "没有提交意图就不发回执");
  assert.deepEqual(await view.cdp.evaluate("__productionQA.errors"), []);
});

test("真实 xterm：安全粘贴未开启时不 begin，开启后的 DSR 应答不打断批次", { timeout: 60_000 }, async (t) => {
  const { view } = await productionFixture(t, { nativeSource, terminalCount: 2 });
  await waitFor(view, "__inboxQA.activated === true");
  await view.cdp.evaluate(`(${emit.toString()})('\\x1b[?2004l\\x1b[2J\\x1b[H› \\r\\n  ? for shortcuts\\r\\n')`);
  await new Promise((done) => setTimeout(done, 2_000));
  assert.equal(await view.cdp.evaluate("__inboxQA.batches.length"), 0);
  assert.equal(await view.cdp.evaluate("__inboxQA.calls.includes('collab_inbox_begin_submit')"), false);
  await view.cdp.evaluate("__inboxQA.queryDuringPaste = true");
  await view.cdp.evaluate(`(${emit.toString()})('\\x1b[?2004h\\x1b[2J\\x1b[H› \\r\\n  ? for shortcuts\\r\\n')`);
  await waitFor(view, "__inboxQA.receipts.length === 1", 20_000);
  const result = await view.cdp.evaluate("({ guarded: __inboxQA.guarded, dsr: __inboxQA.dsr, inputRevision: __inboxQA.inputRevision, receipts: __inboxQA.receipts })");
  assert.ok(result.guarded[0].text.startsWith("\x1b[200~"));
  assert.ok(result.guarded[0].text.endsWith("\x1b[201~"));
  assert.match(result.dsr, /^\x1b\[\d+;\d+R$/);
  assert.equal(result.inputRevision, 0);
  assert.deepEqual(result.guarded.map((write) => write.sequence), [1, 2]);
  assert.equal(result.receipts[0].phase, "submitted");
  assert.deepEqual(await view.cdp.evaluate("__productionQA.errors"), []);
});

test("收件箱英文窄窗可阅读、返回和打开目标会话", { timeout: 60_000 }, async (t) => {
  const { view } = await productionFixture(t, { nativeSource: `${nativeSource}\nlocalStorage.setItem('belfry.locale.v1', 'en');`, terminalCount: 2 });
  await view.bounds({ x: 0, y: 0, width: 720, height: 480 });
  await waitFor(view, "__inboxQA.activated === true");
  await click(view, 'button[title="Session collaboration"]');
  await waitFor(view, "!!document.querySelector('.inbox-session[data-session=sk-be]')");
  assert.match(await view.cdp.evaluate("document.querySelector('.inbox').innerText"), /Needs attention/);
  await shot(view, "720x480-inbox-sessions-en");
  await click(view, ".inbox-session[data-session=sk-be]");
  await waitFor(view, "document.querySelectorAll('.inbox-message').length === 5");
  const detail = await view.cdp.evaluate("document.querySelector('.inbox--detail').innerText");
  assert.match(detail, /Awaiting reply/);
  assert.match(detail, /Reply to 后端:/);
  assert.match(detail, /Open session/);
  assert.equal(await view.cdp.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
  await shot(view, "720x480-inbox-detail-en");
  await press(view, "Escape");
  await waitFor(view, "!!document.querySelector('.inbox-session[data-session=sk-be]') && !document.querySelector('.inbox--detail')");
  await click(view, ".inbox-session[data-session=sk-be]");
  await waitFor(view, "!!document.querySelector('.inbox-open')");
  await click(view, ".inbox-open");
  await waitFor(view, "!document.querySelector('.collab-panel')");
  assert.deepEqual(await view.cdp.evaluate("__productionQA.errors"), []);
});
