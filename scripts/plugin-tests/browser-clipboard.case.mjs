import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { panelFixture, browserAvailable, showGuest, guestValue } from "./panel-support.mjs";

async function clipboardFixture(t, body, files = {}) {
  const writes = [];
  let reads = 0, copied;
  const copiedText = new Promise((resolve) => { copied = resolve; });
  const fixture = await panelFixture(t, { platform: ({ api, args }) => {
    if (api === "clipboard.writeText") { writes.push(args[0]); copied(args[0]); }
    if (api === "clipboard.readText") reads++;
  } });
  t.after(() => assert.equal(0, reads));
  for (const [name, content] of Object.entries(files)) await writeFile(join(fixture.workspace, name), content);
  await writeFile(join(fixture.workspace, "guest.html"), `<!doctype html>${body}`);
  assert.equal(true, await showGuest(fixture.view));
  return { ...fixture, writes, copiedText };
}

function key(view, value) {
  return view.cdp.evaluate(`pluginBridge.invoke('browser.input',${JSON.stringify({
    kind: "key", type: "keyDown", key: value, code: `Key${value.toUpperCase()}`,
    keyCode: value.toUpperCase().charCodeAt(0), modifiers: 4,
  })})`);
}

test("browser copies selected Unicode text to the desktop clipboard without reading it", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, writes } = await clipboardFixture(t, '<input value="复制中文与 emoji 📝">');
  await guestValue(view, "document.querySelector('input').select();true");
  await key(view, "c");
  assert.deepEqual(["复制中文与 emoji 📝"], writes);
});

test("browser cut transfers the selection and keeps the native undo history", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, writes } = await clipboardFixture(t, '<input value="before 中间 after">');
  await guestValue(view, "(()=>{const input=document.querySelector('input');input.focus();input.setSelectionRange(7,9);return true})()");
  await key(view, "x");
  assert.equal("before  after", await guestValue(view, "document.querySelector('input').value"));
  assert.deepEqual(["中间"], writes);
  await key(view, "z");
  assert.equal("before 中间 after", await guestValue(view, "document.querySelector('input').value"));
});

test("browser copy respects a page's custom clipboard payload", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, writes } = await clipboardFixture(t, `<input value="original"><script>
    addEventListener('copy',event=>{event.clipboardData.setData('text/plain','自定义复制');event.preventDefault()});
  </script>`);
  await guestValue(view, "document.querySelector('input').select();true");
  await key(view, "c");
  assert.deepEqual(["自定义复制"], writes);
});

test("empty, cancelled and password selections preserve the desktop clipboard", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, writes } = await clipboardFixture(t, '<input value="ordinary"><input type="password" value="private">');
  await guestValue(view, "document.querySelector('input').focus();true");
  await key(view, "c");
  await guestValue(view, "document.querySelector('input[type=password]').select();true");
  await key(view, "c");
  await guestValue(view, "document.querySelector('input').select();addEventListener('copy',event=>event.preventDefault(),{once:true});true");
  await key(view, "c");
  assert.deepEqual([], writes);
});

test("the panel forwards the actual Ctrl+C shortcut through to the desktop", { timeout: 20_000 }, async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, copiedText } = await clipboardFixture(t, '<input value="Keyboard copy">');
  await guestValue(view, "document.querySelector('input').select();true");
  await view.cdp.evaluate('document.querySelector("[aria-label=浏览器键盘输入]").focus();true');
  await view.send("Input.dispatchKeyEvent", { type: "keyDown", key: "c", code: "KeyC", windowsVirtualKeyCode: 67, modifiers: 2 });
  assert.equal("Keyboard copy", await copiedText);
});

test("browser copy follows a focused iframe and a shadow-root input", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, writes } = await clipboardFixture(t, '<iframe></iframe><div id="shadow"></div>', {
    "child.html": '<!doctype html><input value="Frame copy">',
  });
  await guestValue(view, `new Promise(resolve=>{const frame=document.querySelector('iframe');
    frame.onload=()=>{frame.contentDocument.querySelector('input').select();resolve(true)};frame.src='child.html';})`);
  await key(view, "c");
  await guestValue(view, `(()=>{const root=document.querySelector('#shadow').attachShadow({mode:'open'});
    root.innerHTML='<input value="Shadow copy">';root.querySelector('input').select();return true})()`);
  await key(view, "c");
  assert.deepEqual(["Frame copy", "Shadow copy"], writes);
});

test("pasted text reaches the guest's native paste handler", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, writes } = await clipboardFixture(t, `<input><script>
    addEventListener('paste',event=>{window.pasted={text:event.clipboardData.getData('text/plain'),trusted:event.isTrusted};
      document.execCommand('insertText',false,'Handled: '+window.pasted.text);event.preventDefault()});
  </script>`);
  await guestValue(view, "document.querySelector('input').focus();true");
  await view.cdp.evaluate(`(()=>{const data=new DataTransfer();data.setData('text/plain','用户粘贴');
    document.querySelector('[aria-label="浏览器键盘输入"]').dispatchEvent(new ClipboardEvent('paste',
      {clipboardData:data,bubbles:true,cancelable:true}));return true})()`);
  const actual = await guestValue(view, `new Promise(resolve=>{const input=document.querySelector('input');
    const done=()=>resolve({value:input.value,pasted:window.pasted??null});
    if(input.value)done();else input.addEventListener('input',()=>queueMicrotask(done),{once:true});})`);
  assert.deepEqual({ value: "Handled: 用户粘贴", pasted: { text: "用户粘贴", trusted: true } }, actual);
  assert.deepEqual([], writes);
});
