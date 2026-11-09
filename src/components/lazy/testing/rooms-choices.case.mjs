import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, capturePanel, click, press, waitFor } from "./roomsQaFixture.mjs";
import { enter } from "../../../../scripts/plugin-tests/market-ui-support.mjs";

const PAGE = "src/components/lazy/testing/rooms-qa.html";
const FE = '.room-choice-card[data-member-id="fe"]';
const BE = '.room-choice-card[data-member-id="be"]';

async function ready(t, query = "attention=0&choices=worktree") {
  const { view } = await browserFixture(t, `${PAGE}?${query}`);
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(view, `!!document.querySelector('${FE} [data-option-index="1"]')`);
  return view;
}

async function typeInto(view, selector, value) {
  await view.cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await view.send("Input.insertText", { text: value });
}

test("available interactions appear before the activity changes to waiting", async t => {
  const { view } = await browserFixture(t, `${PAGE}?attention=0&choices=worktree`);
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(view, "typeof qaReadInteraction === 'function' && !!document.querySelector('[aria-label=房间对话] article')");
  await capturePanel(view, "room-choice-active-member");
  assert.equal(await view.cdp.evaluate("document.querySelector('section[aria-label=需要你处理]')?.textContent.includes('Where should the new conversation run?') ?? false"), true);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), [], "reading a request does not choose the terminal's current item");
});

test("choice titles and descriptions are separate and current item changes remain visible", async t => {
  const { view } = await browserFixture(t, `${PAGE}?choices=worktree`);
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(view, "document.querySelector('section[aria-label=需要你处理]')?.textContent.includes('Where should the new conversation run?')");
  await capturePanel(view, "room-choice-worktree");
  const copy = await view.cdp.evaluate(`({
    titles: [...document.querySelectorAll('.room-choice-option-title')].map(el => el.textContent),
    descriptions: [...document.querySelectorAll('.room-choice-option-description')].map(el => el.textContent),
  })`);
  assert.deepEqual(copy.titles, ["Use current Git worktree", "Create new Git worktree"]);
  assert.deepEqual(copy.descriptions, ["Keep using the current working directory", "Create a separate checkout of this repository in another directory"]);
  await view.cdp.evaluate("qaPatchInteraction('t2', { selected: 2 })");
  await waitFor(view, "document.querySelector('[data-option-index=\"2\"]')?.getAttribute('aria-current') === 'true'");
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
});

test("keyboard selection submits once and stays disabled while the reply is pending", async t => {
  const view = await ready(t);
  await view.cdp.evaluate(`qaHoldChoice('t2'); document.querySelector('${FE} [data-option-index="1"]').focus()`);
  await press(view, "ArrowDown");
  assert.equal(await view.cdp.evaluate("document.activeElement.dataset.optionIndex"), "2");
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), [], "moving keyboard focus never submits");
  await enter(view);
  await waitFor(view, `document.querySelector('${FE}')?.dataset.requestState === 'submitting'`);
  await view.cdp.evaluate(`document.querySelector('${FE} [data-option-index="2"]').click()`);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls.map(({ tabId, requestId, sessionId, answer }) => ({ tabId, requestId, sessionId, answer }))"), [
    { tabId: "t2", requestId: "worktree-1", sessionId: "session-t2", answer: { kind: "single", index: 2 } },
  ]);
  await view.cdp.evaluate("qaResolveChoice('t2', { status: 'sent' })");
  await waitFor(view, `document.querySelector('${FE}')?.dataset.requestState === 'submitted'`);
  assert.equal(await view.cdp.evaluate(`document.querySelectorAll('${FE} [data-option-index]:disabled').length`), 2);
  await capturePanel(view, "room-choice-submitted");
});

test("multiple members keep multi-select and input drafts through polling and language changes", async t => {
  const view = await ready(t);
  await view.cdp.evaluate(`(() => {
    const base = qaReadInteraction('t2');
    qaSetInteraction('t2', { ...base, requestId: 'checks-1', kind: 'multiple', question: 'Which checks should run?', selectedIndices: [2],
      options: [{ index: 1, label: 'Unit tests', description: 'Check request handling' }, { index: 2, label: 'Browser tests' }, { index: 3, label: 'Build' }] });
    qaSetInteraction('t3', { ...base, requestId: 'path-1', source: { sessionId: 'session-t3', agent: 'codex' }, kind: 'input',
      question: 'Where should the report be saved?', selected: null, options: [], input: { label: 'Report path' } });
  })()`);
  await waitFor(view, `document.querySelectorAll('${FE} [role=checkbox]').length === 3 && !!document.querySelector('${BE} textarea')`);
  await click(view, `${FE} [role=checkbox]:first-of-type`);
  await typeInto(view, `${BE} textarea`, "/tmp/my report.md");
  await view.cdp.evaluate("qaPatchInteraction('t2', { selected: 3, selectedIndices: [3] }); qaPatchInteraction('t3', { question: 'Where should the final report be saved?' }); qaSetLocale('en')");
  await waitFor(view, `document.querySelector('${BE} h3')?.textContent === 'Where should the final report be saved?' && document.querySelector('${FE}')?.textContent.includes('Submit selection')`);
  assert.deepEqual(await view.cdp.evaluate(`[...document.querySelectorAll('${FE} [role=checkbox]')].map(el => el.getAttribute('aria-checked'))`), ["true", "true", "false"]);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${BE} textarea').value`), "/tmp/my report.md");
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
  await capturePanel(view, "room-choice-multiple-members");
  await click(view, `${FE} button[type=submit]`);
  await click(view, `${BE} button[type=submit]`);
  await waitFor(view, "qaChoiceCalls.length === 2");
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls.map(({ tabId, requestId, answer }) => ({ tabId, requestId, answer }))"), [
    { tabId: "t2", requestId: "checks-1", answer: { kind: "multiple", indices: [1, 2] } },
    { tabId: "t3", requestId: "path-1", answer: { kind: "input", text: "/tmp/my report.md" } },
  ]);
});

test("changed requests and replacement sessions reject stale buttons before submission", async t => {
  const view = await ready(t);
  await view.cdp.evaluate(`(() => {
    const button = document.querySelector('${FE} [data-option-index="1"]');
    qaPatchInteraction('t2', { requestId: 'worktree-2', question: 'Choose the next workspace' }); button.click();
  })()`);
  await waitFor(view, `document.querySelector('${FE} h3')?.textContent === 'Choose the next workspace'`);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
  await view.cdp.evaluate(`(() => {
    const button = document.querySelector('${FE} [data-option-index="1"]');
    qaPatchInteraction('t2', { source: { sessionId: 'replacement-t2', agent: 'codex' }, question: 'New terminal request' }); button.click();
  })()`);
  await waitFor(view, `document.querySelector('${FE} h3')?.textContent === 'New terminal request'`);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
  await click(view, `${FE} [data-option-index="2"]`);
  assert.equal(await view.cdp.evaluate("qaChoiceCalls[0].sessionId"), "replacement-t2");
});

test("late results cannot mark a replacement request as sent or overwrite its input", async t => {
  const view = await ready(t);
  await view.cdp.evaluate("qaHoldChoice('t2')");
  await click(view, `${FE} [data-option-index="1"]`);
  await waitFor(view, "qaChoiceCalls.length === 1");
  await view.cdp.evaluate(`qaPatchInteraction('t2', { requestId: 'next-input', kind: 'input', question: 'What should happen next?',
    state: 'pending', options: [], selected: null, input: { label: 'Next step' } })`);
  await waitFor(view, `!!document.querySelector('${FE} textarea')`);
  await typeInto(view, `${FE} textarea`, "Keep this new draft");
  await view.cdp.evaluate("qaResolveChoice('t2', { status: 'failed', message: 'Old request failure' }); qaPatchInteraction('t2', { detail: 'Latest request context' })");
  await waitFor(view, `document.querySelector('${FE}')?.textContent.includes('Latest request context')`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FE} textarea').value`), "Keep this new draft");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FE} button[type=submit]').disabled`), false);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FE}').textContent.includes('Old request failure')`), false);
});

test("definite failures allow a deliberate retry while uncertain delivery stays locked", async t => {
  const view = await ready(t);
  await view.cdp.evaluate("qaChoiceResult('t2', { status: 'failed', message: 'PTY not ready' })");
  await click(view, `${FE} [data-option-index="2"]`);
  await waitFor(view, `document.querySelector('${FE} [role=alert]')?.textContent.includes('PTY not ready')`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FE} [data-option-index="2"]').disabled`), false);
  await view.cdp.evaluate("qaSetLocale('en')");
  await waitFor(view, `document.querySelector('${FE} [role=alert]')?.textContent.includes('The reply was not sent')`);
  await view.cdp.evaluate("qaChoiceResult('t2', { status: 'uncertain' })");
  await click(view, `${FE} [data-option-index="2"]`);
  await waitFor(view, `document.querySelector('${FE}')?.dataset.requestState === 'uncertain'`);
  await view.cdp.evaluate(`document.querySelector('${FE} [data-option-index="2"]').click()`);
  assert.equal(await view.cdp.evaluate("qaChoiceCalls.length"), 2);
  assert.equal(await view.cdp.evaluate(`document.querySelectorAll('${FE} [data-option-index]:disabled').length`), 2);
  await click(view, `${FE} .room-choice-terminal`);
  assert.deepEqual(await view.cdp.evaluate("qaOpened"), ["t2"]);
  await capturePanel(view, "room-choice-uncertain");
});

test("unknown requests have a terminal action and closed or departed requests disappear", async t => {
  const view = await ready(t);
  await view.cdp.evaluate("qaSetActivity('t2', 'awaiting-choice'); qaPatchInteraction('t2', { kind: 'unknown', requestId: 'unknown-1', question: 'This terminal is waiting', options: [], selected: null })");
  await waitFor(view, `document.querySelector('${FE}')?.dataset.requestKind === 'unknown'`);
  assert.equal(await view.cdp.evaluate(`document.querySelectorAll('${FE} [data-option-index], ${FE} button[type=submit]').length`), 0);
  await click(view, `${FE} .room-choice-terminal`);
  assert.deepEqual(await view.cdp.evaluate("qaOpened"), ["t2"]);
  await view.cdp.evaluate("window.qaSavedInteraction = qaReadInteraction('t2'); qaSetInteraction('t2', null)");
  await waitFor(view, `!document.querySelector('${FE}')`);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
  await view.cdp.evaluate("qaSetInteraction('t2', { ...qaSavedInteraction, requestId: 'unknown-2' })");
  await waitFor(view, `!!document.querySelector('${FE}')`);
  await view.cdp.evaluate("qaRemoveMember('fe')");
  await waitFor(view, `!document.querySelector('${FE}')`);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
});

test("partial option pages keep original indices and confirmation uses a single answer", async t => {
  const view = await ready(t);
  await view.cdp.evaluate(`qaPatchInteraction('t2', { requestId: 'page-2', kind: 'confirmation', optionsComplete: false, selected: 4,
    question: 'Select a model', options: [{ index: 4, label: 'Model A' }, { index: 5, label: 'Model B', description: 'Current visible page' }] })`);
  await waitFor(view, `document.querySelector('${FE}')?.textContent.includes('到终端查看更多选项')`);
  assert.equal(await view.cdp.evaluate(`document.querySelectorAll('${FE} [data-option-index]').length`), 2);
  await view.cdp.evaluate(`document.querySelector('${FE} .room-choice-help button').focus()`);
  await enter(view);
  assert.deepEqual(await view.cdp.evaluate("qaOpened"), ["t2"]);
  await click(view, `${FE} [data-option-index="5"]`);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls[0].answer"), { kind: "single", index: 5 });
  await view.cdp.evaluate("qaPatchInteraction('t2', { requestId: 'unknown-empty', kind: 'unknown', state: 'pending', question: '', options: [] })");
  await waitFor(view, `document.querySelector('${FE} h3')?.textContent === '这条会话需要你的输入'`);
});

test("legacy readers still answer safely and a detached source cannot receive a reply", async t => {
  const view = await ready(t, "choices=legacy");
  await view.cdp.evaluate("qaPatchInteraction('t2', { selected: 2 })");
  await waitFor(view, `document.querySelector('${FE} [data-option-index="2"]')?.getAttribute('aria-current') === 'true'`);
  await click(view, `${FE} [data-option-index="1"]`);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls[0].answer"), { kind: "single", index: 1 });
  await view.cdp.evaluate("qaPatchInteraction('t2', { requestId: 'legacy-next' }); qaChoiceSession('t2', null)");
  await waitFor(view, `document.querySelector('${FE}')?.dataset.requestState === 'pending'`);
  await click(view, `${FE} [data-option-index="1"]`);
  assert.equal(await view.cdp.evaluate("qaChoiceCalls.length"), 1);
});

for (const locale of ["zh-CN", "en"]) {
  for (const theme of ["dark", "light"]) {
    for (const [width, height] of [[1440, 900], [720, 480]]) {
      for (const font of [14, 20]) {
        test(`long requests retain chat and usable controls (${locale}, ${theme}, ${width}x${height}, ${font}px)`, async t => {
          const view = await ready(t, `attention=0&choices=worktree&locale=${locale}&theme=${theme}`);
          await view.bounds({ x: 0, y: 0, width, height });
          await view.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
          const question = locale === "en" ? "Choose the working directory for the next conversation: " : "请选择新会话的工作目录：";
          const path = "/Users/cheng/project/" + "long-directory-without-a-space/".repeat(6);
          const detail = Array.from({ length: 10 }, (_, i) => `git worktree ${i + 1} ${path}`).join("\n");
          await view.cdp.evaluate(`document.documentElement.style.fontSize = '${font}px'; qaPatchInteraction('t2', { question: ${JSON.stringify(question + path)}, detail: ${JSON.stringify(detail)} });`);
          await waitFor(view, `document.querySelector('${FE} h3')?.textContent.includes('long-directory')`);
          const message = `textarea[aria-label="${locale === "en" ? "Message" : "消息"}"]`;
          await typeInto(view, message, "T36 chat remains usable");
          const geometry = await view.cdp.evaluate(`(() => {
            const panel = document.querySelector('.room-attention'), main = panel.closest('main'), bounds = main.getBoundingClientRect();
            const chat = document.querySelector('[aria-label="${locale === "en" ? "Room conversation" : "房间对话"}"]');
            const scroll = document.querySelector('.room-attention-scroll');
            const send = document.querySelector('button[aria-label="${locale === "en" ? "Send" : "发送"}"]');
            const r = send.getBoundingClientRect();
            return { page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
              panel: panel.getBoundingClientRect().toJSON(), chat: chat.clientHeight, scroll: { height: scroll.clientHeight, total: scroll.scrollHeight },
              sendVisible: r.top >= 0 && r.bottom <= innerHeight && send.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
              escaped: [...panel.querySelectorAll('h3, .room-choice-option-title, .room-choice-option-description, pre')].filter(el => {
                if (!el.getClientRects().length) return false;
                const b = el.getBoundingClientRect(); return b.left < bounds.left - 1 || b.right > bounds.right + 1;
              }).map(el => el.textContent.slice(0, 40)) };
          })()`);
          t.diagnostic(JSON.stringify({ geometry }));
          await capturePanel(view, `room-choice-${locale}-${theme}-${width}-${font}`);
          assert.deepEqual(geometry.escaped, []);
          assert.equal(geometry.page.width, width);
          assert.equal(geometry.page.height, height);
          assert.ok(geometry.chat >= 80, `conversation height is ${geometry.chat}px`);
          assert.ok(geometry.sendVisible, "Send retains its visible click position");
          assert.ok(geometry.scroll.height > 0 && geometry.panel.height <= height * 0.4);
          await view.cdp.evaluate(`document.querySelector('${FE} summary').focus()`);
          await enter(view);
          await waitFor(view, `document.querySelector('${FE} details').open`);
          assert.equal(await view.cdp.evaluate(`document.querySelector('${FE} pre').textContent`), detail);
          await view.cdp.evaluate(`document.querySelector('${FE} pre').focus()`);
          await press(view, "End");
          await waitFor(view, `document.querySelector('${FE} pre').scrollTop > 0`);
          await view.cdp.evaluate(`document.querySelector('${FE} [data-option-index="1"]').focus()`);
          await press(view, "ArrowDown");
          assert.equal(await view.cdp.evaluate("document.activeElement.dataset.optionIndex"), "2");
          await enter(view);
          await waitFor(view, "qaChoiceCalls.length === 1");
          assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls[0].answer"), { kind: "single", index: 2 });
          assert.equal(await view.cdp.evaluate(`document.querySelector(${JSON.stringify(message)}).value`), "T36 chat remains usable");
          await click(view, `button[aria-label="${locale === "en" ? "Send" : "发送"}"]`);
          await waitFor(view, "qaCalls.some(call => call.command === 'room_say' && call.args.text === 'T36 chat remains usable')");
          if (width === 720) await click(view, ".room-compact-nav button:nth-child(2)");
          await click(view, `aside[aria-label="${locale === "en" ? "Task board" : "任务板"}"] header button`);
          await waitFor(view, `!!document.querySelector('aside[aria-label="${locale === "en" ? "Task board" : "任务板"}"] form input')`);
        });
      }
    }
  }
}
