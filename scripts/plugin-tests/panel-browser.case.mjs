import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { panelFixture, browserAvailable, showGuest, clickGuest } from "./panel-support.mjs";

test("real panel FileReader reads selected bytes, slices files, aborts and mirrors custom themes", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, runtime, workspace, text } = await panelFixture(t, { body: '<input type="file" id="pick">' });
  const result = await view.cdp.evaluate(`(async () => {
    const input=document.querySelector('#pick');
    const picked=new Promise(resolve=>input.addEventListener('change',resolve,{once:true})); input.click(); await picked;
    const file=input.files[0], reader=new FileReader(), events=[];
    reader.onloadstart=()=>events.push('start'); reader.onprogress=()=>events.push('progress');
    const loaded=new Promise((resolve,reject)=>{ reader.onload=()=>resolve({length:reader.result.length,prefix:reader.result.slice(0,5)}); reader.onerror=()=>reject(reader.error); });
    reader.readAsText(file); const result=await loaded;
    const aborted=new FileReader(); aborted.readAsArrayBuffer(file); aborted.abort();
    return { ...result, size:file.size, slice:await file.slice(0,13).text(), hasProgress:events.includes('progress'),
      aborted:aborted.readyState===2&&aborted.result===null&&aborted.error===null };
  })()`).catch((error) => { throw new Error("FileReader content verification failed", { cause: error }); });
  assert.equal(result.length, text.length); assert.equal(result.prefix, text.slice(0, 5));
  assert.equal(result.size, Buffer.byteLength(text)); assert.equal(result.slice, "文件内容:");
  assert.equal(result.hasProgress, true); assert.equal(result.aborted, true);
  // 等待浏览器确认订阅，再从另一条宿主通道发事件，避免测试丢失快到的外观通知。
  await view.cdp.evaluate("window.__qaAppearance = new Promise(resolve=>addEventListener('pi-plugin-appearance',()=>resolve(getComputedStyle(document.documentElement).getPropertyValue('--qa-theme').trim()),{once:true})); true");
  await runtime.call("context", { workspace, appearance: { theme: "plugin:mine.theme:custom", base: "light", locale: "zh-CN",
    pluginTheme: { id: "mine.theme:custom", base: "light", css: ":root { --qa-theme: verified; }" } } });
  const changed = await view.cdp.evaluate("window.__qaAppearance")
    .catch((error) => { throw new Error("Appearance event verification failed after FileReader completed", { cause: error }); });
  assert.equal(changed, "verified");
});

test("the embedded browser streams its page into plugin chrome and forwards keyboard input", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, workspace } = await panelFixture(t, { body: "<p>浏览器工具栏</p>" });
  await writeFile(join(workspace, "guest.html"), '<!doctype html><style>input{position:absolute;left:20px;top:20px;width:180px;height:30px}</style><input aria-label="Guest input"><title>Guest</title>');
  const ready = await showGuest(view);
  assert.equal(ready, true);
  await clickGuest(view);
  await view.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, text: "a" });
  await view.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  const value = await view.cdp.evaluate(`pluginBridge.invoke('browser.evaluate',{expression: \`new Promise(resolve => {
    const input=document.querySelector('input');
    if(input.value)resolve(input.value); else input.addEventListener('input',()=>resolve(input.value),{once:true});
  })\`})`);
  assert.equal(value, "a");
});
