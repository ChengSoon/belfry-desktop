// 只读原型的真实点击验证 + 截图。用法：node tools/verify.mjs [截图输出目录]
// 只打开本地 file:// 页面，不连接任何 Belfry 服务。
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch, sleep } from "./cdp.mjs";

const url = pathToFileURL(fileURLToPath(new URL("../index.html", import.meta.url))).href;
const out = process.argv[2] || fileURLToPath(new URL("../../screenshots/", import.meta.url));
mkdirSync(out, { recursive: true });
const p = await launch();
const S = (expr) => p.eval(`(() => { const s = window.__prototypeState(); ${expr} })()`);
const text = (sel) => p.eval(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ""`);
const rowText = (key) => text(`.session[data-id="${key}"]`);
const results = [];
async function step(name, fn) { try { await fn(); results.push(["ok", name]); } catch (e) { results.push(["FAIL", name, e.message]); } }
const fresh = async (w, h, hash = "") => { await p.viewport(w, h); await p.goto(url); await p.eval("localStorage.clear()"); await p.send("Page.navigate", { url: "about:blank" }); await sleep(150); await p.eval("void 0"); await p.goto(url + hash); };
const demo = (id) => p.click(`[data-action=demo][data-id=${id}]`);
const open = (key) => p.click(`.session[data-id="${key}"]`);

await step("主界面只读：没有投递/暂缓/撤回/答复等操作按钮，演示控制默认隐藏", async () => {
  await fresh(1440, 900);
  const labels = await p.eval(`[...document.querySelectorAll('button:not(.session)')].filter(b => b.offsetParent).map(b => b.innerText.trim())`);
  for (const bad of ["投递", "暂缓", "撤回", "答复", "优先", "合并"]) assert.ok(!labels.some((l) => l.includes(bad)), `出现了「${bad}」按钮：${labels}`);
  assert.equal(await p.eval(`document.querySelector('#demo-panel').hidden`), true);
  assert.match(await text(".sample-tag"), /示例数据/);
  await p.shot(`${out}/1440-sessions.png`);
});

await step("同为 Codex 的三个会话各占一行，按 tabId 区分", async () => {
  const rows = await p.eval(`[...document.querySelectorAll('.session .agent')].map(e => e.innerText)`);
  assert.deepEqual(rows.filter((r) => r.startsWith("Codex")).sort(), ["Codex · 3b9f", "Codex · 7e02", "Codex · a41c"]);
});

await step("会话行：一句状态 + 有积压才显示计数；混合原因写“部分消息等待投递”", async () => {
  assert.match(await rowText("be"), /部分消息等待投递/);         // 协商等轮次 + 任务等交差
  assert.match(await rowText("be"), /4 条等待投递 · 1 个问题待回复/);
  assert.match(await rowText("mgr"), /已投递待回复/);
  assert.equal(await text('.session[data-id="mgr"] .session-counts'), "1 个问题待回复", "没有积压时不显示等待投递计数");
  assert.match(await rowText("qa"), /等待成员上线/);
  assert.match(await rowText("doc"), /提交结果待核对，后续投递已暂停/);
});

await step("详情：逐条原文、逐问题状态（已回复/待回复/尚未送达）、等待原因分开解释", async () => {
  await open("be");
  const d = await text("#detail");
  assert.match(d, /等待上一任务完成 · T60 调整接口返回值/);   // 新任务等交差
  assert.match(d, /等待成员结束当前轮次/);                     // 协商只等轮次
  assert.match(d, /已回复：从 1 开始/);
  assert.match(d, /待回复/);
  assert.match(d, /尚未送达/);
  assert.match(d, /成员已确认处理 · 以交差为准/);               // 送达≠完成
});

await step("仅知会、处理情况未知、已撤回的文案", async () => {
  await open("fe");
  const d = await text("#detail");
  assert.match(d, /仅知会，已记录/);
  assert.match(d, /已提交到终端，处理情况未知/);
  await open("mgr");
  assert.match(await text("#detail"), /待发消息已撤回/);
  assert.doesNotMatch(await rowText("mgr"), /超时的问题/, "撤回的消息不作为最后一条摘要");
});

await step("筛选“有待处理”只保留有积压或待核对的会话", async () => {
  await p.click("[data-action=filter][data-id=active]");
  const keys = await p.eval(`[...document.querySelectorAll('.session')].map(e => e.dataset.id)`);
  assert.deepEqual(keys, ["mgr", "fe", "be", "qa", "doc"]);  // 示例中每个会话都有积压、待回复或待核对
  await p.click("[data-action=filter][data-id=all]");
});

await step("浅色主题", async () => {
  await open("be");
  await p.click("#theme");
  await p.shot(`${out}/1440-detail-light.png`);
  await p.click("#theme");
  await p.shot(`${out}/1440-detail.png`);
});

// ---- 以下用 #demo 控制模拟后台事件，验证界面如何呈现结果 ----
await step("后台：新消息留在同一会话；轮次结束后协商自动送达，新任务仍等交差", async () => {
  await fresh(1440, 900, "#demo");
  await open("be");
  const before = await S("return s.sessions.length");
  await demo("incoming");
  assert.equal(await S("return s.sessions.length"), before);
  assert.match(await rowText("be"), /5 条等待投递/);
  await demo("turn");
  assert.match(await rowText("be"), /正在投递消息/);
  await sleep(1500);
  assert.equal(await S("return s.messages.find(m => m.id === 'm107').delivery"), "pending");
  assert.equal(await S("return s.messages.find(m => m.id === 'm101').delivery"), "submitted");
  assert.match(await rowText("be"), /等待上一任务完成/);
  assert.match(await rowText("be"), /1 条等待投递 · 3 个问题待回复/);
  await p.shot(`${out}/1440-demo-after-turn.png`);
});

await step("后台：交差后新任务才送达，送达后显示“以交差为准”而非完成", async () => {
  await demo("finish");
  await sleep(1500);
  assert.equal(await S("return s.messages.find(m => m.id === 'm107').delivery"), "submitted");
  assert.match(await text("#msg-m107"), /以交差为准|处理情况未知/);
  assert.doesNotMatch(await text("#msg-m107"), /任务已交差/);
});

await step("后台：只回复一个问题，其余仍待回复；回复进入提问方会话", async () => {
  await open("mgr");
  await demo("answer");
  assert.match(await text("#msg-m109"), /已回复/);
  await open("be");
  const open1 = await S("return s.messages.filter(m => m.to === 'be' && m.delivery === 'submitted').flatMap(m => (m.questions||[]).filter(q => q.state === 'open')).length");
  await demo("answer");
  const open2 = await S("return s.messages.filter(m => m.to === 'be' && m.delivery === 'submitted').flatMap(m => (m.questions||[]).filter(q => q.state === 'open')).length");
  assert.equal(open2, open1 - 1, "一次只结掉一个问题");
  assert.match(await rowText("fe"), /等待投递/);
});

await step("后台：提交不确定 → 该会话后续投递暂停，核对后恢复；重启把投递中转为待核对", async () => {
  await open("doc");
  assert.match(await text("#detail .status-line"), /待核对/);
  await demo("verify");
  await sleep(1500);
  assert.equal(await S("return s.messages.find(m => m.id === 'm131').delivery"), "submitted");
  await open("mgr");
  await demo("uncertain");
  await demo("incoming");
  await sleep(1500);
  assert.match(await rowText("mgr"), /待核对/);
  await demo("incoming");
  await p.goto(url + "#demo");                 // 页面重开 = 应用重启
  assert.equal(await S("return s.messages.filter(m => m.delivery === 'submitting').length"), 0);
});

await step("后台：离线与房间暂停只保存不投递", async () => {
  await demo("reset");
  await open("qa");
  assert.match(await text("#detail .status-line"), /等待成员上线/);
  await demo("pause");
  await demo("online");
  assert.match(await rowText("qa"), /投递已暂停，消息已保存/);
  assert.equal(await S("return s.messages.filter(m => m.to === 'qa' && m.delivery !== 'pending').length"), 0);
  await demo("pause");
  assert.equal(await S("return s.messages.filter(m => m.to === 'qa' && m.delivery === 'submitting').length"), 2, "恢复且上线后，后台自动投递保留的任务与协商");
});

await step("720×480：列表 → 详情 → 返回，能看能点，无横向溢出", async () => {
  await fresh(720, 480);
  await p.shot(`${out}/720-sessions.png`);
  await open("be");
  assert.ok(await p.eval(`getComputedStyle(document.querySelector('.list-pane')).display === 'none'`));
  await p.shot(`${out}/720-detail.png`);
  await p.click("[data-action=locate]");
  await p.click("#detail .back");
  assert.ok(await p.eval(`getComputedStyle(document.querySelector('.list-pane')).display !== 'none'`));
  await open("fe");
  await p.key("Escape");
  assert.ok(await p.eval(`!document.querySelector('#app').classList.contains('show-detail')`));
  assert.equal(await p.eval(`document.documentElement.scrollWidth > innerWidth`), false);
  await p.click("#theme");
  await p.shot(`${out}/720-sessions-light.png`);
});

await step("无运行时错误", async () => { assert.deepEqual(p.errors, []); });

await p.close();
for (const r of results) console.log(r.join(" · "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} 通过；截图 ${out}`);
process.exit(failed ? 1 : 0);
