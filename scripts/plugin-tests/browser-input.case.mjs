import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { panelFixture, browserAvailable, showGuest, clickGuest, guestValue } from "./panel-support.mjs";

const INPUT_PAGE = '<!doctype html><style>input{position:absolute;left:20px;top:20px;width:180px;height:30px}</style>';
const VALUE = "document.querySelector('input').value";

test("browser input keeps native paste available and forwards the actual pasted text", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, workspace } = await panelFixture(t);
  await writeFile(join(workspace, "guest.html"), `${INPUT_PAGE}<input aria-label="Guest input">`);
  assert.equal(true, await showGuest(view)); await clickGuest(view);
  const allowed = await view.cdp.evaluate(`(() => {
    const target=document.querySelector('[aria-label="浏览器键盘输入"]');
    return [true,false].map(metaKey => target.dispatchEvent(new KeyboardEvent('keydown',
      {key:'v',code:'KeyV',keyCode:86,metaKey,ctrlKey:!metaKey,bubbles:true,cancelable:true})));
  })()`);
  assert.deepEqual([true, true], allowed);
  await view.cdp.evaluate(`(() => {
    const data=new DataTransfer(); data.setData('text/plain','粘贴的文字');
    document.querySelector('[aria-label="浏览器键盘输入"]').dispatchEvent(new ClipboardEvent('paste',
      {clipboardData:data,bubbles:true,cancelable:true}));
  })()`);
  const actual = await guestValue(view, `new Promise(resolve=>{
    const input=document.querySelector('input');
    if(input.value)resolve(input.value); else input.addEventListener('input',()=>resolve(input.value),{once:true});
  })`);
  assert.equal("粘贴的文字", actual);
});

test("browser select-all and undo use native editing commands", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, workspace } = await panelFixture(t);
  await writeFile(join(workspace, "guest.html"), `${INPUT_PAGE}<input value="original" aria-label="Guest input">`);
  assert.equal(true, await showGuest(view)); await clickGuest(view);
  await view.cdp.evaluate("pluginBridge.invoke('browser.input',{kind:'key',type:'keyDown',key:'a',code:'KeyA',keyCode:65,modifiers:4})");
  await view.cdp.evaluate("pluginBridge.invoke('browser.input',{kind:'text',text:'replacement'})");
  assert.equal("replacement", await guestValue(view, VALUE));
  await view.cdp.evaluate("pluginBridge.invoke('browser.input',{kind:'key',type:'keyDown',key:'z',code:'KeyZ',keyCode:90,modifiers:4})");
  assert.equal("original", await guestValue(view, VALUE));
});

test("browser file inputs open the desktop picker and receive real files without plugin file access", async (t) => {
  if (!await browserAvailable(t)) return;
  const choices = [];
  const { view, workspace, text } = await panelFixture(t, {
    manifest: { permissions: ["ui.view", "browser.cdp"], fs: undefined },
    platform: ({ api, args, selected }) => {
      if (api === "browser.pickFiles") { choices.push(args[0]); return [selected]; }
    },
  });
  await writeFile(join(workspace, "guest.html"), `${INPUT_PAGE}<input type="file" accept=".txt,text/plain" multiple>`);
  assert.equal(true, await showGuest(view)); await clickGuest(view);
  const result = await guestValue(view, `new Promise(resolve=>{
    const input=document.querySelector('input');
    const read=async()=>{const file=input.files[0];resolve(file?{name:file.name,size:file.size,prefix:await file.slice(0,13).text()}:null)};
    if(input.files.length)void read(); else input.addEventListener('change',read,{once:true});
    setTimeout(()=>resolve(null),1500);
  })`);
  assert.deepEqual({ name: "large.txt", size: Buffer.byteLength(text), prefix: "文件内容:" }, result);
  assert.deepEqual([{ multiple: true, accept: ".txt,text/plain" }], choices);
});

test("browser directory inputs preserve relative paths and file contents", async (t) => {
  if (!await browserAvailable(t)) return;
  let upload;
  const choices = [];
  const { view, workspace } = await panelFixture(t, { platform: ({ api, args }) => {
    if (api === "browser.pickFiles") { choices.push(args[0]); return [upload]; }
  } });
  upload = join(workspace, "folder"); await mkdir(join(upload, "nested"), { recursive: true });
  await writeFile(join(upload, "top.txt"), "top"); await writeFile(join(upload, "nested", "note.txt"), "nested");
  await writeFile(join(workspace, "guest.html"), `${INPUT_PAGE}<input type="file" webkitdirectory>`);
  assert.equal(true, await showGuest(view)); await clickGuest(view);
  const result = await guestValue(view, `new Promise(resolve=>{
    const input=document.querySelector('input');
    const read=async()=>resolve(await Promise.all([...input.files].map(async file=>({path:file.webkitRelativePath,text:await file.text()}))));
    if(input.files.length)void read(); else input.addEventListener('change',read,{once:true});
    setTimeout(()=>resolve(null),1500);
  })`);
  assert.deepEqual([{ path: "folder/nested/note.txt", text: "nested" }, { path: "folder/top.txt", text: "top" }], result?.sort((a, b) => a.path.localeCompare(b.path)));
  assert.equal(true, choices[0]?.directory);
});

test("cancelling a browser file chooser preserves the selected file and dispatches cancel", async (t) => {
  if (!await browserAvailable(t)) return;
  let calls = 0;
  const { view, workspace } = await panelFixture(t, { platform: ({ api, selected }) => {
    if (api === "browser.pickFiles") return ++calls === 1 ? [selected] : [];
  } });
  await writeFile(join(workspace, "guest.html"), `${INPUT_PAGE}<input type="file">`);
  assert.equal(true, await showGuest(view)); await clickGuest(view);
  assert.equal("large.txt", await guestValue(view, `new Promise(resolve=>{
    const input=document.querySelector('input');
    const done=()=>resolve(input.files[0]?.name);
    if(input.files.length)done(); else input.addEventListener('change',done,{once:true});
  })`));
  await guestValue(view, `window.cancelled=false;document.querySelector('input').addEventListener('cancel',()=>window.cancelled=true);true`);
  await clickGuest(view);
  const result = await guestValue(view, `new Promise(resolve=>{
    const input=document.querySelector('input');
    const done=()=>resolve({cancelled:window.cancelled,name:input.files[0]?.name});
    if(window.cancelled)done(); else input.addEventListener('cancel',done,{once:true});
  })`);
  assert.deepEqual({ cancelled: true, name: "large.txt" }, result);
  assert.equal(2, calls);
});
