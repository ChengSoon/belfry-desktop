import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { uiFixture, click, clickText, press, waitFor, fill, setValue, resize, evidence } from "./production-uiFixture.mjs";

const ROOM_NATIVE = await readFile(new URL("./rooms-uiNative.js", import.meta.url), "utf8");
const ROOM = 'button[title="协作房间"]';
const COMPOSER = 'textarea[aria-label="房间消息"]';
const ADD = 'button[aria-label="添加图片或文档"]';
const DRAFTS = ".room-attachments--draft .room-attachment";

async function createRoom(view, name) {
  await waitFor(view, "!!document.querySelector('button[aria-label=\"新建房间\"]')");
  await click(view, 'button[aria-label="新建房间"]');
  await waitFor(view, "!!document.querySelector('.room-dialog input')");
  await fill(view, ".room-dialog input", name);
  await clickText(view, "创建", ".room-dialog");
  await waitFor(view, `document.querySelector('.room-stream__title strong')?.textContent === ${JSON.stringify(name)}`);
}

async function paste(view, names = [], text = "", kind = "paste") {
  return view.cdp.evaluate(`(() => {
    const data = new DataTransfer();
    for (const name of ${JSON.stringify(names)}) {
      const image = name.endsWith('.png');
      data.items.add(new File([image ? new Uint8Array(window.__attachmentImageBytes) : '%PDF-1.7 synthetic document'], name,
        {type: image ? 'image/png' : 'application/pdf', lastModified: 1}));
    }
    if (${JSON.stringify(text)}) data.setData('text/plain', ${JSON.stringify(text)});
    const el = document.querySelector(${JSON.stringify(COMPOSER)});
    el.focus();
    const event = ${JSON.stringify(kind)} === 'drop'
      ? new DragEvent('drop', {dataTransfer:data, bubbles:true, cancelable:true})
      : new ClipboardEvent('paste', {clipboardData:data, bubbles:true, cancelable:true});
    el.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
}

async function seedImage(view) {
  await view.cdp.evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#d5decf'; ctx.fillRect(0,0,320,180);
    ctx.fillStyle = '#38544a'; ctx.fillRect(24,24,96,132); ctx.fillStyle = '#f7f8f1'; ctx.fillRect(136,24,160,60);
    ctx.fillStyle = '#6c8875'; ctx.fillRect(136,100,160,56);
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    window.__attachmentImageBytes = [...new Uint8Array(await blob.arrayBuffer())];
  })()`);
}

async function systemTheme(view, mode) {
  await view.send("Emulation.setEmulatedMedia", { features: [
    { name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value: mode },
  ] });
  await waitFor(view, `document.documentElement.dataset.theme === ${JSON.stringify(mode)}`);
}

test("room attachments paste images and documents, preview, retry, reload and route", { timeout: 150_000 }, async t => {
  const { view, origin } = await uiFixture(t, { nativeExtension: ROOM_NATIVE });
  await click(view, ROOM);
  await createRoom(view, "附件协作");
  await seedImage(view);

  // 普通文本粘贴替换选区；原生文件探测不会吃字或重复插入。
  await setValue(view, COMPOSER, "查看旧内容。");
  await view.cdp.evaluate(`document.querySelector(${JSON.stringify(COMPOSER)}).setSelectionRange(2, 5)`);
  assert.equal(await paste(view, [], "新说明"), true);
  await waitFor(view, `document.querySelector(${JSON.stringify(COMPOSER)}).value === '查看新说明。'`);
  await setValue(view, COMPOSER, "");

  assert.equal(await paste(view, ["页面参考.png", "需求说明.pdf"]), true);
  await waitFor(view, `document.querySelectorAll('${DRAFTS}').length === 2 && !document.querySelector('.room-send').disabled`);
  await waitFor(view, "document.querySelector('.room-attachments--draft img')?.naturalWidth === 320");
  assert.equal(await view.cdp.evaluate(`document.querySelector(${JSON.stringify(COMPOSER)}).value`), "");
  await click(view, '.room-attachment__open[title="预览 页面参考.png"]');
  await waitFor(view, "!!document.querySelector('.room-image-preview img')");
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.room-image-preview') && !!document.querySelector('.room-view')");
  await systemTheme(view, "dark");
  await evidence(view, "room-attachments-draft", [COMPOSER, ADD, ".room-send"]);
  await systemTheme(view, "light");
  await evidence(view, "room-attachments-light", [COMPOSER, ADD, ".room-send"]);
  await systemTheme(view, "dark");
  await resize(view, 1024, 720);
  await evidence(view, "room-attachments-compact", [COMPOSER, ADD, ".room-send"]);
  await resize(view, 1440, 960);

  // 移除与文件选择都使用相同的附件列表。
  await click(view, 'button[aria-label="移除附件 需求说明.pdf"]');
  await waitFor(view, `document.querySelectorAll('${DRAFTS}').length === 1`);
  await view.cdp.evaluate(`__roomFilesQA.pickPaths = ['/synthetic/需求说明.pdf'];
    __roomFilesQA.sources['/synthetic/需求说明.pdf'] = {bytes: [37,80,68,70], mimeType:'application/pdf'};`);
  await click(view, ADD);
  await waitFor(view, `document.querySelectorAll('${DRAFTS}').length === 2 && !document.querySelector('.room-send').disabled`);
  await view.cdp.evaluate("__roomFilesQA.failNextSend = true");
  await click(view, ".room-send");
  await waitFor(view, "[...document.querySelectorAll('.room-view [role=\"alert\"]')].some(el => el.textContent.includes('合成发送失败'))");
  assert.equal(await view.cdp.evaluate(`document.querySelectorAll('${DRAFTS}').length`), 2, "发送失败保留附件");
  await click(view, ".room-send");
  await waitFor(view, "document.querySelectorAll('.room-message .room-attachment').length === 2 && !document.querySelector('.room-attachments--draft')");
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'room_send_message').at(-1).args.text"), "");
  await click(view, '.room-message button[aria-label="在文件夹中显示 需求说明.pdf"]');
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'room_reveal_attachment').length"), 1);

  // 从持久化的消息重新读取预览，重载前的 object URL 不可复用。
  await view.navigate({ url: `${origin}/` });
  await waitFor(view, "!!document.querySelector('button[title=\"协作房间\"]')");
  await click(view, ROOM);
  await waitFor(view, "document.querySelectorAll('.room-message .room-attachment').length === 2");
  await waitFor(view, "document.querySelector('.room-message img')?.naturalWidth === 320");
  await click(view, 'button[aria-label="搜索讨论"]');
  await fill(view, 'input[aria-label="搜索讨论"]', "需求说明.pdf");
  await waitFor(view, "document.querySelectorAll('.room-message').length === 1");
  await press(view, "Escape"); await press(view, "Escape");

  // 原生粘贴文件列表；文件名中的 @ 不得改变群聊的收件人。
  await view.cdp.evaluate(`(async () => {
    const room = __roomsQA.rooms[0];
    const tabs = JSON.parse(localStorage.getItem('belfry.workspace.v1')).tabs;
    await __TAURI_INTERNALS__.invoke('room_add_member', {id:room.id, tabId:tabs[0].id, agent:'claude', role:'设计', duty:''});
    await __TAURI_INTERNALS__.invoke('room_add_member', {id:room.id, tabId:tabs[1].id, agent:'codex', role:'开发', duty:''});
    __roomFilesQA.sources['/synthetic/@设计.pdf'] = {bytes:[37,80,68,70], mimeType:'application/pdf'};
    __roomFilesQA.clipboardPaths = ['/synthetic/@设计.pdf'];
  })()`);
  await waitFor(view, "document.querySelectorAll('.room-recipient').length === 2");
  await paste(view, [], "@设计.pdf");
  await waitFor(view, `document.querySelectorAll('${DRAFTS}').length === 1 && !document.querySelector('.room-send').disabled`);
  assert.equal(await view.cdp.evaluate(`document.querySelector(${JSON.stringify(COMPOSER)}).value`), "");
  assert.match(await view.cdp.evaluate("document.querySelector('.room-send').textContent"), /发到群聊（2）/);
  await click(view, ".room-send");
  await waitFor(view, "__roomsQA.rooms[0].messages.at(-1).attachments?.length === 1 && __roomsQA.rooms[0].messages.at(-1).memberIds.length === 2");

  // 选中成员后，只有附件的任务也能派发，任务详情保留同一份附件。
  await paste(view);
  await waitFor(view, `document.querySelectorAll('${DRAFTS}').length === 1 && !document.querySelector('.room-send').disabled`);
  await clickText(view, "开发", ".room-composer__recipients");
  await click(view, ".room-send");
  await waitFor(view, "!!document.querySelector('.room-taskcard') && !document.querySelector('.room-attachments--draft')");
  await click(view, ".room-taskcard");
  await waitFor(view, "document.querySelector('.room-dialog .room-attachment')?.textContent.includes('@设计.pdf')");
  await press(view, "Escape");
  await evidence(view, "room-attachments-sent", [COMPOSER, ADD]);
});

test("room attachment limits and asynchronous work never leak into another draft", { timeout: 120_000 }, async t => {
  const { view } = await uiFixture(t, { nativeExtension: ROOM_NATIVE });
  await click(view, ROOM);
  await createRoom(view, "资料 A");
  await seedImage(view);
  assert.equal(await paste(view, ["拖入文档.pdf"], "", "drop"), true);
  await waitFor(view, `document.querySelectorAll('${DRAFTS}').length === 1 && !document.querySelector('.room-send').disabled`);
  const before = await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'room_paste_attachment').length");
  await view.cdp.evaluate(`(() => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(20 * 1024 * 1024 + 1)], '太大的.pdf'));
    document.querySelector(${JSON.stringify(COMPOSER)}).dispatchEvent(new ClipboardEvent('paste', {clipboardData:data,bubbles:true,cancelable:true}));
  })()`);
  await waitFor(view, "document.querySelector('.room-composer__error')?.textContent.includes('20 MB')");
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'room_paste_attachment').length"), before);
  await paste(view, Array.from({ length: 11 }, (_, index) => `文档-${index}.pdf`));
  await waitFor(view, `document.querySelectorAll('${DRAFTS}').length === 10 && !document.querySelector('.room-send').disabled`);
  assert.match(await view.cdp.evaluate("document.querySelector('.room-composer__error').textContent"), /10/);
  await view.cdp.evaluate("[...document.querySelectorAll('.room-attachments--draft .room-attachment__action')].forEach(button => button.click())");
  await waitFor(view, "!document.querySelector('.room-attachments--draft')");

  // 导入还没回包就移除：回包中的文件必须清掉，不能重新出现。
  await view.cdp.evaluate("__roomFilesQA.holdNextImport = true");
  const discardsBefore = await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'room_discard_attachment').length");
  await paste(view, ["慢速.pdf"]);
  await waitFor(view, "typeof __roomFilesQA.finishImport === 'function'");
  assert.equal(await view.cdp.evaluate("document.querySelector('.room-send').disabled"), true);
  await click(view, 'button[aria-label="移除附件 慢速.pdf"]');
  await view.cdp.evaluate("__roomFilesQA.finishImport()");
  await waitFor(view, `__productionQA.calls.filter(call => call.command === 'room_discard_attachment').length > ${discardsBefore}`);
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.room-attachments--draft')"), false);

  // 原生拖放按输入框坐标命中；不把文件掉进背后的终端。
  await view.cdp.evaluate(`(() => {
    __roomFilesQA.sources['/synthetic/原生拖入.pdf'] = {bytes:[37,80,68,70], mimeType:'application/pdf'};
    const rect = document.querySelector('.room-composer').getBoundingClientRect();
    for (const call of __productionQA.calls.filter(call => call.command === 'plugin:event|listen' && call.args.event === 'tauri://drag-drop')) {
      callbacks.get(call.args.handler)?.({ event:'tauri://drag-drop', id:1,
        payload:{ paths:['/synthetic/原生拖入.pdf'], position:{x:(rect.x+60)*devicePixelRatio, y:(rect.y+60)*devicePixelRatio}} });
    }
  })()`);
  await waitFor(view, `document.querySelectorAll('${DRAFTS}').length === 1 && !document.querySelector('.room-send').disabled`);
  await setValue(view, COMPOSER, "A 的附件");
  await view.cdp.evaluate("__roomFilesQA.holdNextSend = true");
  await click(view, ".room-send");
  await waitFor(view, "typeof __roomFilesQA.finishSend === 'function'");
  await createRoom(view, "资料 B");
  await setValue(view, COMPOSER, "B 的草稿");
  await view.cdp.evaluate("__roomFilesQA.finishSend()");
  await waitFor(view, "__roomsQA.rooms[0].messages.some(message => message.text === 'A 的附件')");
  assert.equal(await view.cdp.evaluate("document.querySelector('.room-stream__title strong').textContent"), "资料 B");
  assert.equal(await view.cdp.evaluate(`document.querySelector(${JSON.stringify(COMPOSER)}).value`), "B 的草稿");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.room-attachments--draft')"), false);
  await clickText(view, "资料 A", ".room-list");
  await waitFor(view, "document.querySelector('.room-message .room-attachment')?.textContent.includes('原生拖入.pdf')");
  await evidence(view, "room-attachments-isolated", [COMPOSER, ADD]);
});
