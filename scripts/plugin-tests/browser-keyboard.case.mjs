import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { panelFixture, browserAvailable, showGuest, clickGuest, guestValue } from "./panel-support.mjs";

const ENTER = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" };
const LETTER = { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, text: "a" };
const INPUT_WAIT_MS = 3000, INPUT_POLL_MS = 20;
const KEYBOARD_PAGE = `<!doctype html>
  <style>#first{position:absolute;left:20px;top:20px;width:180px;height:30px}</style>
  <form><input id="first" aria-label="Guest input"><input id="second"><button id="submit">Submit</button></form>
  <textarea id="multiline"></textarea>
  <script>
    window.keys=[];window.keyUps=0;window.submissions=0;
    document.addEventListener('keydown',event=>window.keys.push({key:event.key,repeat:event.repeat,location:event.location,trusted:event.isTrusted}));
    document.addEventListener('keyup',()=>window.keyUps++);
    document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.submissions++});
  </script>`;

async function fixture(t) {
  const result = await panelFixture(t);
  await writeFile(join(result.workspace, "guest.html"), KEYBOARD_PAGE);
  assert.equal(true, await showGuest(result.view)); await clickGuest(result.view);
  return result;
}

function stroke(key) {
  return [{ ...key, type: "keyDown" }, { ...key, type: "keyUp", text: undefined, unmodifiedText: undefined }];
}

async function sendKeys(view, events) {
  const completed = await guestValue(view, "window.keyUps");
  for (const event of events) await view.send("Input.dispatchKeyEvent", event);
  const expected = completed + events.filter((event) => event.type === "keyUp").length;
  await guestValue(view, `new Promise((resolve,reject)=>{
    const deadline=Date.now()+${INPUT_WAIT_MS};
    const check=()=>{if(window.keyUps>=${expected})resolve(true);else if(Date.now()>deadline)reject(new Error('按键转发超时'));else setTimeout(check,${INPUT_POLL_MS})};check();
  })`);
}

test("Enter in an embedded browser submits the page's native form", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view } = await fixture(t);
  await sendKeys(view, stroke(ENTER));
  assert.equal(await guestValue(view, "window.submissions"), 1);
  assert.equal(await guestValue(view, "window.keys[0].trusted"), true);
});

test("Enter and Shift+Enter insert native textarea line breaks", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view } = await fixture(t);
  await guestValue(view, "document.querySelector('#multiline').focus();true");
  await sendKeys(view, stroke(LETTER));
  await sendKeys(view, stroke(ENTER));
  await sendKeys(view, stroke({ ...ENTER, modifiers: 8 }));
  assert.equal(await guestValue(view, "document.querySelector('#multiline').value"), "a\n\n");
});

test("a page can cancel Enter without the host forcing submission or insertion", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view } = await fixture(t);
  await guestValue(view, "document.querySelector('#first').addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault()});true");
  await sendKeys(view, stroke(ENTER));
  assert.equal(await guestValue(view, "window.submissions"), 0);
  assert.equal(await guestValue(view, "document.querySelector('#first').value"), "");
});

test("held keys preserve native repeat events and type one character per keydown", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view } = await fixture(t);
  const [down, up] = stroke(LETTER);
  await sendKeys(view, [down, { ...down, autoRepeat: true }, up]);
  assert.equal(await guestValue(view, "document.querySelector('#first').value"), "aa");
  assert.deepEqual(await guestValue(view, "window.keys.map(event=>event.repeat)"), [false, true]);
});

test("numpad Enter preserves its key location while submitting a form", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view } = await fixture(t);
  await sendKeys(view, stroke({ ...ENTER, code: "NumpadEnter", isKeypad: true }));
  assert.equal(await guestValue(view, "window.keys[0].location"), 3);
  assert.equal(await guestValue(view, "window.submissions"), 1);
});

test("Tab, Shift+Tab and Space retain native focus and button behavior", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view } = await fixture(t);
  const tab = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 };
  await sendKeys(view, stroke(tab));
  assert.equal(await guestValue(view, "document.activeElement.id"), "second");
  await sendKeys(view, stroke({ ...tab, modifiers: 8 }));
  assert.equal(await guestValue(view, "document.activeElement.id"), "first");
  await guestValue(view, "document.querySelector('#submit').focus();true");
  await sendKeys(view, stroke({ key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " }));
  assert.equal(await guestValue(view, "window.submissions"), 1);
});

test("printable Option characters follow the host platform's keyboard behavior", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view } = await fixture(t);
  await sendKeys(view, stroke({ key: "™", code: "Digit2", windowsVirtualKeyCode: 50, modifiers: 1, text: "™" }));
  await sendKeys(view, stroke({ key: "|", code: "Digit7", windowsVirtualKeyCode: 55, modifiers: 1, text: "|" }));
  assert.equal(await guestValue(view, "document.querySelector('#first').value"), process.platform === "darwin" ? "™|" : "");
});
