import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { BrowserProcess } from "../src-tauri/src/plugins/node/browser-process.mjs";
import { BrowserTarget } from "../src-tauri/src/plugins/node/browser-target.mjs";

// Shared with the isolated browser through toString(); keep this function pure.
// Threshold is the maximum allowed difference in any RGBA channel (0–255).
export function pixelDifference(before, after, threshold = 0) {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) throw new Error("Threshold must be an integer from 0 to 255");
  if (before.width !== after.width || before.height !== after.height) throw new Error("Image dimensions differ; images are never rescaled");
  const { width, height } = before, pixels = width * height;
  if (!pixels || before.data.length !== pixels * 4 || after.data.length !== pixels * 4) throw new Error("Invalid RGBA image data");
  const overlay = new Uint8ClampedArray(pixels * 4);
  let changedPixels = 0, exactChangedPixels = 0, channelDifference = 0;
  let left = width, top = height, right = -1, bottom = -1;
  for (let offset = 0; offset < before.data.length; offset += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel++) {
      const difference = Math.abs(before.data[offset + channel] - after.data[offset + channel]);
      channelDifference += difference; delta = Math.max(delta, difference);
    }
    if (delta) exactChangedPixels++;
    if (delta > threshold) {
      changedPixels++;
      const x = offset / 4 % width, y = Math.floor(offset / 4 / width);
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      overlay.set([239, 48, 92, 255], offset);
    } else {
      const gray = Math.round((after.data[offset] * .2126 + after.data[offset + 1] * .7152 + after.data[offset + 2] * .0722) * .35 + 255 * .65);
      overlay.set([gray, gray, gray, 255], offset);
    }
  }
  return { width, height, totalPixels: pixels, changedPixels, exactChangedPixels,
    changedPercent: changedPixels / pixels * 100, exactChangedPercent: exactChangedPixels / pixels * 100,
    meanAbsoluteChannelDifference: channelDifference / (pixels * 4),
    bounds: changedPixels ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : null,
    overlay };
}

export function pairCaptures(before, after) {
  if (before.platform !== after.platform) throw new Error(`Platform mismatch: ${before.platform} / ${after.platform}`);
  const index = (manifest, label) => {
    if (!Array.isArray(manifest.captures) || !manifest.captures.length) throw new Error(`${label}: empty or missing captures`);
    const entries = new Map();
    for (const capture of manifest.captures) {
      if (typeof capture.filename !== "string" || !capture.filename.endsWith(".png")) throw new Error(`${label}: invalid PNG filename`);
      if (entries.has(capture.filename)) throw new Error(`${label}: duplicate capture ${capture.filename}`);
      entries.set(capture.filename, capture);
    }
    return entries;
  };
  const first = index(before, "Baseline"), second = index(after, "After");
  return [...new Set([...first.keys(), ...second.keys()])].sort().map(filename => ({ filename, before: first.get(filename), after: second.get(filename) }));
}

async function pngFile(directory, capture) {
  const root = await realpath(directory), path = await realpath(resolve(root, capture.filename));
  const location = relative(root, path);
  if (isAbsolute(location) || location === ".." || location.startsWith("../") || location.startsWith("..\\")) throw new Error("PNG path leaves the input directory");
  const data = await readFile(path);
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid PNG signature");
  if (data.length < 24) throw new Error("Truncated PNG header");
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (capture.sha256 && sha256 !== capture.sha256) throw new Error("PNG hash does not match the capture manifest");
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  if (!width || !height || width * height > 16000000) throw new Error("Invalid or oversized PNG dimensions");
  if (capture.width !== width || capture.height !== height) throw new Error("PNG dimensions do not match the capture manifest");
  return { width, height, sha256, dataUrl: `data:image/png;base64,${data.toString("base64")}` };
}

async function comparePngs(view, before, after, threshold) {
  const result = await view.send("Runtime.evaluate", {
    returnByValue: true, awaitPromise: true,
    expression: `(async () => {
      const decode = async url => {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const a = await decode(${JSON.stringify(before.dataUrl)}), b = await decode(${JSON.stringify(after.dataUrl)});
      const { overlay, ...stats } = (${pixelDifference.toString()})(a, b, ${threshold});
      const canvas = document.createElement('canvas'); canvas.width = a.width; canvas.height = a.height;
      canvas.getContext('2d').putImageData(new ImageData(overlay, a.width, a.height), 0, 0);
      return { ...stats, diffDataUrl: canvas.toDataURL('image/png') };
    })()`,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

export async function compareDirectories(beforeDirectory, afterDirectory, outputDirectory, { threshold = 0 } = {}) {
  // Validate before creating output files or starting a browser.
  pixelDifference({ width: 1, height: 1, data: [0, 0, 0, 0] }, { width: 1, height: 1, data: [0, 0, 0, 0] }, threshold);
  const before = JSON.parse(await readFile(join(beforeDirectory, "manifest.json"), "utf8"));
  const after = JSON.parse(await readFile(join(afterDirectory, "manifest.json"), "utf8"));
  const pairs = pairCaptures(before, after);
  const root = await mkdtemp(join(tmpdir(), "belfry-ui-diff-"));
  let browser, view;
  try {
    browser = await new BrowserProcess(join(root, "chrome")).start();
    view = await new BrowserTarget(browser, { workspace: root, frame() {}, state() {} }).start();
    const results = [], images = [];
    for (const [index, pair] of pairs.entries()) {
      const entry = { filename: pair.filename, before: pair.before ?? null, after: pair.after ?? null };
      if (!pair.before || !pair.after) {
        results.push({ ...entry, status: pair.before ? "missing-after" : "added-after" }); continue;
      }
      try {
        const first = await pngFile(beforeDirectory, pair.before), second = await pngFile(afterDirectory, pair.after);
        if (first.width !== second.width || first.height !== second.height) throw new Error("Image dimensions differ; images are never rescaled");
        if (pair.before.theme !== pair.after.theme) throw new Error("Capture themes do not match");
        const { diffDataUrl, ...stats } = await comparePngs(view, first, second, threshold);
        const image = { before: first.dataUrl, after: second.dataUrl, diff: diffDataUrl };
        results.push({ ...entry, status: stats.changedPixels ? "changed" : "identical", ...stats });
        images.push({ index, ...image });
      } catch (error) { results.push({ ...entry, status: "invalid", error: error.message }); }
    }
    const compared = results.filter(entry => ["changed", "identical"].includes(entry.status));
    const totalPixels = compared.reduce((sum, entry) => sum + entry.totalPixels, 0);
    const changedPixels = compared.reduce((sum, entry) => sum + entry.changedPixels, 0);
    const exactChangedPixels = compared.reduce((sum, entry) => sum + entry.exactChangedPixels, 0);
    const warnings = [];
    if (before.browser?.product !== after.browser?.product) warnings.push("Browser versions differ; text rasterization may affect pixel differences.");
    const summary = { generatedAt: new Date().toISOString(), platform: before.platform, threshold,
      baselineDirectory: resolve(beforeDirectory), afterDirectory: resolve(afterDirectory),
      baselineScenario: before.scenario, afterScenario: after.scenario,
      baselineSource: before.source, afterSource: after.source,
      baselineAssets: before.productionAssets, afterAssets: after.productionAssets,
      warnings, paired: compared.length, changed: compared.filter(entry => entry.status === "changed").length,
      identical: compared.filter(entry => entry.status === "identical").length, incomplete: results.length - compared.length,
      totalPixels, changedPixels, exactChangedPixels, changedPercent: totalPixels ? changedPixels / totalPixels * 100 : null,
      exactChangedPercent: totalPixels ? exactChangedPixels / totalPixels * 100 : null, results };
    await mkdir(join(outputDirectory, "diffs"), { recursive: true });
    for (const image of images) await writeFile(join(outputDirectory, "diffs", `${image.index}.png`), Buffer.from(image.diff.split(",")[1], "base64"));
    await writeFile(join(outputDirectory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    await writeFile(join(outputDirectory, "index.html"), renderReport(summary, images));
    return summary;
  } finally {
    try { if (view) await view.close(); }
    finally { try { if (browser) await browser.close(); } finally { await rm(root, { recursive: true, force: true }); } }
  }
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }

export function renderReport(summary, images) {
  const indexed = new Map(images.map(image => [image.index, image]));
  const percent = value => value === null ? "—" : value.toFixed(5) + "%";
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Belfry UI 截图对比 · ${escapeHtml(summary.platform)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#202536;font:14px/1.6 system-ui,sans-serif}header,main{max-width:1760px;margin:auto;padding:28px}h1{font-size:25px;margin:0 0 8px}h2{font-size:16px;margin:0}p{margin:6px 0}code{overflow-wrap:anywhere;font-size:12px}.stats{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.stat{min-width:140px;background:white;border:1px solid #d8dce7;border-radius:10px;padding:12px 18px}.stat strong{display:block;font-size:24px}.toolbar{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:16px;background:white;border:1px solid #d8dce7;border-radius:10px}.toolbar label{display:flex;gap:6px;align-items:center}.warning{padding:10px 14px;background:#fff2d6;border-radius:8px}article{background:white;border:1px solid #d8dce7;border-radius:12px;margin:0 0 24px;padding:18px}article[hidden]{display:none}.meta{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}.changed{color:#ac1545}.identical{color:#216341}.invalid,.missing-after,.added-after{color:#aa3a1d}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0;min-width:0}figcaption{font-size:12px;color:#59627a;margin:0 0 6px}.frame{overflow:auto;max-height:760px;background:#e9ebf1;border:1px solid #d8dce7;border-radius:6px}.frame img{display:block;width:100%;height:auto;cursor:zoom-in}body.actual .frame img{width:auto;max-width:none}a{color:#3449b3}details{margin-top:16px}pre{white-space:pre-wrap;font-size:12px}.table-wrap{overflow:auto;margin-top:16px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{text-align:left;padding:6px 10px;border-bottom:1px solid #d8dce7;white-space:nowrap}th{background:#e9ebf1}td:first-child{white-space:normal;overflow-wrap:anywhere}@media(max-width:900px){header,main{padding:16px}.grid{grid-template-columns:1fr}.frame{max-height:600px}}@media(prefers-color-scheme:dark){body{background:#171b25;color:#e5e8f2}article,.toolbar,.stat{background:#222835;border-color:#404b61}.frame,th{background:#1b2030;border-color:#404b61}td,th{border-color:#404b61}figcaption{color:#bcc6de}.identical{color:#a4d9b4}.changed{color:#ff99b6}.warning{color:#2a210a}a{color:#aab9ff}}
</style>
<header><h1>Belfry UI 截图对比 · ${escapeHtml(summary.platform)}</h1><p>阈值 ${summary.threshold}/255：任一 RGBA 通道差值大于阈值即计入。红色显示计入差异的像素，灰色显示改后参考。百分比按总像素加权，不判断变化是否符合设计预期。</p>
${summary.baselineScenario || summary.afterScenario ? `<p class="warning">基线条件：${escapeHtml(summary.baselineScenario)}<br>改后条件：${escapeHtml(summary.afterScenario)}</p>` : ""}
<div class="stats"><div class="stat">完成配对<strong>${summary.paired}</strong></div><div class="stat">有差异 / 相同<strong>${summary.changed} / ${summary.identical}</strong></div><div class="stat">像素差异<strong>${percent(summary.changedPercent)}</strong></div><div class="stat">不完整<strong>${summary.incomplete}</strong></div></div>
${summary.warnings.map(warning => `<p class="warning">${escapeHtml(warning)}</p>`).join("")}
<div class="toolbar"><label>显示<select id="filter"><option value="all">全部截图</option><option value="changed">有差异</option><option value="identical">相同</option><option value="incomplete">不完整</option></select></label><label><input id="actual" type="checkbox">按原始像素显示，可横向滚动</label><span>点击截图打开原图预览</span></div>
<details><summary>构建与目录信息</summary><pre>${escapeHtml(JSON.stringify({ baseline: summary.baselineDirectory, after: summary.afterDirectory, baselineSource: summary.baselineSource, afterSource: summary.afterSource, baselineAssets: summary.baselineAssets, afterAssets: summary.afterAssets }, null, 2))}</pre></details>
<div class="table-wrap"><table><thead><tr><th>截图</th><th>状态</th><th>差异像素</th><th>差异比例</th><th>严格比例（阈值 0）</th></tr></thead><tbody>${summary.results.map((entry, index) => `<tr><td><a href="#capture-${index}">${escapeHtml(entry.filename)}</a></td><td>${escapeHtml(entry.status)}</td><td>${entry.changedPixels ?? "—"}</td><td>${percent(entry.changedPercent ?? null)}</td><td>${percent(entry.exactChangedPercent ?? null)}</td></tr>`).join("")}</tbody></table></div></header>
<main>${summary.results.map((entry, index) => {
    const image = indexed.get(index);
    return `<article id="capture-${index}" data-status="${entry.status}"><div class="meta"><h2>${escapeHtml(entry.filename)}</h2><strong class="${entry.status}">${escapeHtml(entry.status)} · ${percent(entry.changedPercent ?? null)}</strong></div>
${image ? `<div class="grid">${[["改前", image.before], ["改后", image.after], ["差异高亮", image.diff]].map(([label, src]) => `<figure><figcaption>${label}</figcaption><div class="frame"><img alt="${label}：${escapeHtml(entry.filename)}" src="${src}"></div></figure>`).join("")}</div><p>差异范围：${entry.bounds ? escapeHtml(JSON.stringify(entry.bounds)) : "无"} · 通道平均绝对差：${entry.meanAbsoluteChannelDifference.toFixed(5)}</p>` : `<p class="warning">${escapeHtml(entry.error ?? "该截图在其中一份 manifest 缺失，请补齐后重新对比。")}</p>`}</article>`;
  }).join("")}</main>
<dialog id="preview" style="width:95vw;max-width:none;max-height:95vh"><form method="dialog"><button>关闭预览</button></form><img alt="原图预览" style="display:block;max-width:100%;height:auto"></dialog>
<script>
document.querySelector('#filter').addEventListener('change', event => { for (const card of document.querySelectorAll('article')) { const value=event.target.value;card.hidden=value!=='all'&&(value==='incomplete'?['changed','identical'].includes(card.dataset.status):card.dataset.status!==value); } });
document.querySelector('#actual').addEventListener('change', event => document.body.classList.toggle('actual',event.target.checked));
for(const image of document.querySelectorAll('.frame img'))image.addEventListener('click',()=>{const dialog=document.querySelector('#preview');dialog.querySelector('img').src=image.src;dialog.showModal();});
</script></html>`;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, threshold: { type: "string", default: "0" }, "fail-on-diff": { type: "boolean", default: false }, help: { type: "boolean" } } });
  if (values.help || positionals.length !== 2 || !values.out) {
    console.log("Usage: node scripts/compare-ui-baseline.mjs <baseline-dir> <after-dir> --out <report-dir> [--threshold 0..255] [--fail-on-diff]");
    if (!values.help) process.exitCode = 1;
    return;
  }
  const summary = await compareDirectories(resolve(positionals[0]), resolve(positionals[1]), resolve(values.out), { threshold: Number(values.threshold) });
  console.log(JSON.stringify({ report: join(resolve(values.out), "index.html"), paired: summary.paired, identical: summary.identical, changed: summary.changed, incomplete: summary.incomplete, changedPercent: summary.changedPercent, threshold: summary.threshold }, null, 2));
  if (summary.incomplete || values["fail-on-diff"] && summary.changed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
