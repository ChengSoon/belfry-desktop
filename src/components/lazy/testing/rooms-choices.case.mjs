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

async function tabTo(view, selector) {
  for (let step = 0; step < 45; step++) {
    await press(view, "Tab");
    if (await view.cdp.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`)) return;
  }
  assert.fail(`Tab did not reach ${selector}`);
}

async function ownsClick(view, selector) {
  return view.cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
      && element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  })()`);
}

async function clickVisible(view, selector, atTextStart = false) {
  assert.ok(await ownsClick(view, selector), `visible click target: ${selector}`);
  const point = await view.cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)}), r = element.getBoundingClientRect(), s = getComputedStyle(element);
    return ${atTextStart} ? { x: r.left + parseFloat(s.paddingLeft) + 1, y: r.top + parseFloat(s.paddingTop) + parseFloat(s.lineHeight) / 2 }
      : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await view.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
}

async function resize(view, width, height, font = 20) {
  await view.bounds({ x: 0, y: 0, width, height });
  await view.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await view.cdp.evaluate(`document.documentElement.style.fontSize = '${font}px'; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
}

async function captureChoicePanel(view, name) {
  // Keep a tooltip's brief exit animation out of the review screenshot.
  await view.cdp.evaluate(`Promise.allSettled([...document.querySelectorAll('[data-slot=tooltip-content][data-state=closed]')]
    .flatMap(element => element.getAnimations({ subtree: true }).map(animation => animation.finished)))`);
  await capturePanel(view, name);
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
  await view.cdp.evaluate("qaPatchInteraction('t2', { options: [{ index: 1, label: 'Use current\\nGit worktree', description: 'Keep this\\nworking directory' }, { index: 2, label: 'Create new Git worktree' }] })");
  await waitFor(view, "document.querySelector('.room-choice-option-title')?.textContent.includes('\\n')");
  const lines = await view.cdp.evaluate(`['.room-choice-option-title', '.room-choice-option-description'].map(selector => {
    const element = document.querySelector(selector), range = document.createRange(); range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map(rect => rect.top)).size;
  })`);
  assert.deepEqual(lines, [2, 2], "manual terminal line breaks remain separate rendered lines");
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

for (const locale of ["zh-CN", "en"]) for (const theme of ["dark", "light"]) {
  test(`compact requests have a visible entry and keyboard access to complete options (${locale}, ${theme})`, async t => {
    const view = await ready(t, `attention=0&choices=worktree&locale=${locale}&theme=${theme}`);
    await resize(view, 720, 480);
    await capturePanel(view, `room-choice-compact-entry-${locale}-${theme}`);
    assert.ok(await ownsClick(view, ".room-attention-open"), "a visible action opens the complete request");
    await tabTo(view, ".room-attention-open");
    await enter(view);
    await waitFor(view, "document.querySelector('.room-attention')?.dataset.expanded === 'true'");
    assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), [], "opening the request is not confirming an answer");
    await captureChoicePanel(view, `room-choice-compact-expanded-${locale}-${theme}`);
    await tabTo(view, `${FE} [data-option-index="2"]`);
    assert.ok(await ownsClick(view, `${FE} [data-option-index="2"]`), "Tab scrolls the real option into the expanded area");
    await captureChoicePanel(view, `room-choice-compact-option-${locale}-${theme}`);
    await enter(view);
    await waitFor(view, "qaChoiceCalls.length === 1");
    assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls[0].answer"), { kind: "single", index: 2 });
    await press(view, "Escape");
    await waitFor(view, "document.querySelector('.room-attention')?.dataset.expanded === 'false'");
    assert.equal(await view.cdp.evaluate("document.activeElement?.matches('.room-attention-open')"), true);
    assert.equal(await view.cdp.evaluate("qaClosed"), 0, "Escape closes the request before the whole room");
  });
}

for (const locale of ["zh-CN", "en"]) {
  test(`compact drafts and pending replies survive collapse, chat clicks and window changes (${locale})`, async t => {
    const view = await ready(t, `attention=0&choices=worktree&locale=${locale}`);
    const message = `textarea[aria-label="${locale === "en" ? "Message" : "消息"}"]`;
    await view.cdp.evaluate(`(() => {
      const base = qaReadInteraction('t2');
      qaSetInteraction('t2', { ...base, requestId: 'compact-multiple', kind: 'multiple', question: 'Which checks should run?', selectedIndices: [2] });
      qaSetInteraction('t3', { ...base, requestId: 'compact-input', source: { sessionId: 'session-t3', agent: 'codex' }, kind: 'input',
        question: 'Where should the report be saved?', selected: null, options: [], input: { label: 'Report path' } });
    })()`);
    await waitFor(view, `!!document.querySelector('${BE} textarea')`);
    await resize(view, 720, 480);
    await clickVisible(view, message);
    await view.send("Input.insertText", { text: "chat draft" });
    await clickVisible(view, ".room-attention-open");
    await tabTo(view, `${FE} [role=checkbox]`);
    await press(view, " ");
    await tabTo(view, `${BE} textarea`);
    await view.send("Input.insertText", { text: "/tmp/compact draft.md" });
    await press(view, "Escape");
    await waitFor(view, "document.querySelector('.room-attention')?.dataset.expanded === 'false'");
    assert.equal(await view.cdp.evaluate("document.activeElement?.matches('.room-attention-open')"), true);
    await clickVisible(view, ".room-attention-open");
    await waitFor(view, "document.querySelector('.room-attention')?.dataset.expanded === 'true'");
    assert.equal(await view.cdp.evaluate(`document.querySelector('${BE} textarea').value`), "/tmp/compact draft.md");
    assert.deepEqual(await view.cdp.evaluate(`[...document.querySelectorAll('${FE} [role=checkbox]')].map(el => el.getAttribute('aria-checked'))`), ["true", "true"]);
    await clickVisible(view, message, true);
    await waitFor(view, "document.querySelector('.room-attention')?.dataset.expanded === 'false'");
    assert.equal(await view.cdp.evaluate(`document.activeElement?.matches(${JSON.stringify(message)}) && document.activeElement.selectionStart === 0`), true, "the first chat click places the caret where clicked");
    await view.send("Input.insertText", { text: "clicked " });
    assert.equal(await view.cdp.evaluate(`document.querySelector(${JSON.stringify(message)}).value`), "clicked chat draft");
    await resize(view, 1440, 900);
    await tabTo(view, `${BE} textarea`);
    await resize(view, 720, 480);
    await waitFor(view, "document.querySelector('.room-attention')?.dataset.expanded === 'true'");
    assert.equal(await view.cdp.evaluate(`document.querySelector('${BE} textarea').value`), "/tmp/compact draft.md");
    assert.deepEqual(await view.cdp.evaluate(`[...document.querySelectorAll('${FE} [role=checkbox]')].map(el => el.getAttribute('aria-checked'))`), ["true", "true"]);
    await view.cdp.evaluate("qaHoldChoice('t3')");
    await press(view, "Enter", 2);
    await waitFor(view, `document.querySelector('${BE}')?.dataset.requestState === 'submitting'`);
    await press(view, "Escape");
    await clickVisible(view, ".room-attention-open");
    assert.equal(await view.cdp.evaluate(`document.querySelector('${BE}')?.dataset.requestState`), "submitting");
    await resize(view, 1440, 900);
    await resize(view, 720, 480);
    assert.equal(await view.cdp.evaluate(`document.querySelector('${BE}')?.dataset.requestState`), "submitting");
    await view.cdp.evaluate("qaResolveChoice('t3', { status: 'sent' })");
    await waitFor(view, `document.querySelector('${BE}')?.dataset.requestState === 'submitted'`);
    assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls.map(call => call.answer)"), [{ kind: "input", text: "/tmp/compact draft.md" }]);
    await tabTo(view, message);
    assert.equal(await view.cdp.evaluate("document.querySelector('.room-attention')?.dataset.expanded"), "false", "Tab can leave the non-modal region for chat");
    assert.equal(await view.cdp.evaluate("qaClosed"), 0);
  });

  test(`pending requests leave the full brief readable and editable in a small window (${locale})`, async t => {
    const view = await ready(t, `attention=0&choices=worktree&locale=${locale}`);
    const brief = { objective: "Review the complete project brief. ".repeat(18), currentFocus: "Verify pending choices and keep the conversation available. ".repeat(6),
      constraints: ["/tmp/" + "long-project-directory/".repeat(12), "Keep all existing requirements."], updatedAt: 1, updatedBy: "user" };
    await view.cdp.evaluate(`qaSetBrief(${JSON.stringify(brief)})`);
    await resize(view, 720, 480);
    await waitFor(view, "!!document.querySelector('.room-brief button[aria-expanded]')");
    await clickVisible(view, ".room-brief button[aria-expanded]");
    await waitFor(view, "document.querySelector('.room-brief button[aria-expanded]')?.getAttribute('aria-expanded') === 'true'");
    await press(view, "Tab", 8);
    assert.equal(await view.cdp.evaluate("document.activeElement?.matches('.room-brief [role=region]')"), true);
    await press(view, "End");
    await waitFor(view, "document.querySelector('.room-brief [role=region]').scrollTop > 0");
    const full = await view.cdp.evaluate(`(() => { const element = document.querySelector('.room-brief [role=region]'); return { height: element.clientHeight, text: element.textContent, selected: getComputedStyle(element).userSelect }; })()`);
    assert.ok(full.height >= 40, `full brief reading area is ${full.height}px`);
    assert.equal(full.selected, "text");
    for (const value of [brief.objective, brief.currentFocus, ...brief.constraints]) assert.ok(full.text.includes(value));
    await capturePanel(view, `room-choice-compact-brief-${locale}`);
    await clickVisible(view, ".room-brief button:not([aria-expanded])");
    await waitFor(view, "!!document.querySelector('.room-brief textarea')");
    assert.equal(await view.cdp.evaluate("document.activeElement === document.querySelector('.room-brief textarea')"), true);
    await view.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 4, windowsVirtualKeyCode: 65, commands: ["selectAll"] });
    await view.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 4, windowsVirtualKeyCode: 65 });
    await view.send("Input.insertText", { text: "Updated while choices are pending" });
    await tabTo(view, ".room-brief button:last-child");
    await clickVisible(view, ".room-brief button:last-child");
    await waitFor(view, "qaCalls.some(call => call.command === 'room_update_brief')");
    const saved = await view.cdp.evaluate("qaCalls.find(call => call.command === 'room_update_brief').args");
    assert.deepEqual(saved, { id: await view.cdp.evaluate("qaRoomIds[0]"), objective: "Updated while choices are pending", focus: brief.currentFocus, constraints: brief.constraints });
    await waitFor(view, "!document.querySelector('.room-brief textarea')");
    assert.ok(await ownsClick(view, ".room-attention-open"));
    assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), [], "brief edits never reply to the terminal");
  });
}

test("compact requests reserve conversation space in the same frame as composer resizing", async t => {
  const view = await ready(t, "attention=0&choices=worktree&locale=en&theme=light");
  await resize(view, 720, 480);
  await clickVisible(view, 'textarea[aria-label="Message"]');
  await view.send("Input.insertText", { text: "T36 chat remains usable" });
  await view.cdp.evaluate("Promise.allSettled(document.querySelector('.room-composer').getAnimations({ subtree: true }).filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished))");
  await clickVisible(view, ".room-attention-open");
  await waitFor(view, "document.querySelector('.room-composer').getBoundingClientRect().top - document.querySelector('.room-attention-body').getBoundingClientRect().bottom >= 80");
  const snapshots = await view.cdp.evaluate(`new Promise((resolve, reject) => {
    const composer = document.querySelector('.room-composer'), body = document.querySelector('.room-attention-body');
    const snapshots = [];
    const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Composer resize was not observed')); }, 5000);
    const observer = new ResizeObserver(() => {
      const input = composer.getBoundingClientRect(), panel = body.getBoundingClientRect();
      snapshots.push({ at: performance.now(), composerTop: input.top, panelBottom: panel.bottom,
        reserve: input.top - panel.bottom, maxHeight: body.style.maxHeight,
        conversation: document.querySelector('[aria-label="Room conversation"]').clientHeight });
      if (snapshots.length === 1) {
        // A real size change after the first observation, without changing the
        // product observer or inventing dimensions for its measurement.
        requestAnimationFrame(() => { composer.style.height = (composer.getBoundingClientRect().height + 4) + 'px'; });
      } else { clearTimeout(timeout); observer.disconnect(); resolve(snapshots); }
    });
    observer.observe(composer);
  })`);
  t.diagnostic(JSON.stringify({ composerResize: snapshots }));
  assert.ok(snapshots[0].reserve >= 80, "the measured resize starts from the reserved conversation space");
  assert.ok(snapshots[0].conversation >= 84, "the resize leaves space for the full conversation reserve");
  assert.equal(snapshots[0].composerTop - snapshots[1].composerTop, 4);
  assert.ok(snapshots[1].reserve >= 80, `same-frame conversation reserve is ${snapshots[1].reserve}px`);
  assert.ok(await ownsClick(view, 'button[aria-label="Send"]'));
  assert.equal(await view.cdp.evaluate('document.querySelector(\'textarea[aria-label="Message"]\').value'), "T36 chat remains usable");
});

test("only explicitly optional input permits an actively submitted empty answer", async t => {
  const view = await ready(t);
  await view.cdp.evaluate("qaPatchInteraction('t2', { requestId: 'required-input', kind: 'input', options: [], input: { label: 'Required answer' } })");
  await waitFor(view, `!!document.querySelector('${FE} textarea')`);
  await click(view, `${FE} textarea`);
  await view.send("Input.insertText", { text: "   " });
  await press(view, "Enter", 2);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FE} [type=submit]').disabled`), true);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
  await view.cdp.evaluate("qaPatchInteraction('t2', { requestId: 'optional-input', input: { label: 'Notes', optional: true } })");
  await waitFor(view, `document.querySelector('${FE} textarea')?.getAttribute('aria-required') === 'false'`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FE} textarea').value`), "");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FE} [type=submit]').disabled`), false);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), [], "an optional empty answer is never submitted automatically");
  await click(view, `${FE} [type=submit]`);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls.map(call => call.answer)"), [{ kind: "input", text: "" }]);
});

test("successive requests retain keyboard access without stealing another member's input", async t => {
  const view = await ready(t);
  await resize(view, 720, 480);
  await clickVisible(view, ".room-attention-open");
  await tabTo(view, `${FE} [data-option-index="2"]`);
  await enter(view);
  await waitFor(view, `document.querySelector('${FE}')?.dataset.requestState === 'submitted'`);
  await view.cdp.evaluate("qaPatchInteraction('t2', { requestId: 'next-keyboard-request', kind: 'multiple', state: 'pending', question: 'Select checks for the new conversation' })");
  await waitFor(view, `document.querySelector('${FE}')?.dataset.requestKind === 'multiple'`);
  await tabTo(view, `${FE} [role=checkbox]`);
  assert.ok(await ownsClick(view, `${FE} [role=checkbox]`));
  await press(view, " ");
  await view.cdp.evaluate(`qaSetInteraction('t3', { ...qaReadInteraction('t2'), requestId: 'other-member-input', source: { sessionId: 'session-t3', agent: 'codex' },
    kind: 'input', question: 'Report path', selected: null, options: [], input: { label: 'Path' } })`);
  await waitFor(view, `!!document.querySelector('${BE} textarea')`);
  await tabTo(view, `${BE} textarea`);
  await view.send("Input.insertText", { text: "preserve other member draft" });
  await view.cdp.evaluate("qaPatchInteraction('t2', { requestId: 'third-keyboard-request', question: 'A different member request' })");
  await waitFor(view, `document.querySelector('${FE} h3')?.textContent === 'A different member request'`);
  assert.equal(await view.cdp.evaluate(`document.activeElement?.matches('${BE} textarea')`), true);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${BE} textarea').value`), "preserve other member draft");
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
          await clickVisible(view, message);
          await view.send("Input.insertText", { text: "T36 chat remains usable" });
          if (height <= 600) await clickVisible(view, ".room-attention-open");
          const geometry = await view.cdp.evaluate(`(() => {
            const panel = document.querySelector('.room-attention'), main = panel.closest('main'), bounds = main.getBoundingClientRect();
            const chat = document.querySelector('[aria-label="${locale === "en" ? "Room conversation" : "房间对话"}"]');
            const scroll = document.querySelector('.room-attention-scroll'), body = document.querySelector('.room-attention-body').getBoundingClientRect();
            const composer = document.querySelector('.room-composer').getBoundingClientRect(), chatBounds = chat.getBoundingClientRect();
            const send = document.querySelector('button[aria-label="${locale === "en" ? "Send" : "发送"}"]');
            const r = send.getBoundingClientRect();
            return { page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
              panel: panel.getBoundingClientRect().toJSON(), chat: chat.clientHeight, scroll: { height: scroll.clientHeight, total: scroll.scrollHeight },
              exposedChat: panel.dataset.compact === 'true' ? chatBounds.bottom - Math.max(chatBounds.top, body.bottom) : chat.clientHeight,
              bodyBottom: body.bottom, composerTop: composer.top,
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
          assert.ok(geometry.exposedChat >= 80, `visible conversation below requests is ${geometry.exposedChat}px`);
          assert.ok(geometry.sendVisible, "Send retains its visible click position");
          assert.ok(geometry.scroll.height > 0 && geometry.panel.height <= height * 0.4);
          await tabTo(view, `${FE} summary`);
          await enter(view);
          await waitFor(view, `document.querySelector('${FE} details').open`);
          assert.equal(await view.cdp.evaluate(`document.querySelector('${FE} pre').textContent`), detail);
          await press(view, "Tab");
          assert.equal(await view.cdp.evaluate(`document.activeElement?.matches('${FE} pre')`), true);
          await press(view, "End");
          await waitFor(view, `document.querySelector('${FE} pre').scrollTop > 0`);
          await tabTo(view, `${FE} [data-option-index="1"]`);
          await press(view, "ArrowDown");
          assert.equal(await view.cdp.evaluate("document.activeElement.dataset.optionIndex"), "2");
          assert.ok(await ownsClick(view, `${FE} [data-option-index="2"]`));
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
