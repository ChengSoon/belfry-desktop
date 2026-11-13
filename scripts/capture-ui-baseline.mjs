// Production React + synthetic IPC in an isolated Chrome profile. No native app,
// real project, credentials or terminal process is accessed by this capture.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { uiFixture, resize, theme, settings, click, press, waitFor, intact } from "../src/components/lazy/testing/production-uiFixture.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(project);
const platform = process.env.BELFRY_UI_PLATFORM ?? "macos";
assert.ok(["macos", "windows"].includes(platform), "BELFRY_UI_PLATFORM must be macos or windows");
const directory = resolve(process.env.BELFRY_UI_BASELINE_OUT ?? `docs/design/belfry-ui/baseline/${platform}`);
// 可选：按指定 UI 字号截图（设置 → 外观的字号档，12–20），用于检查最大字号下的布局。
const fontSize = process.env.BELFRY_UI_FONT_SIZE ? Number(process.env.BELFRY_UI_FONT_SIZE) : null;
assert.ok(fontSize === null || (Number.isInteger(fontSize) && fontSize >= 12 && fontSize <= 20), "BELFRY_UI_FONT_SIZE must be an integer between 12 and 20");
const sizes = (process.env.BELFRY_UI_SIZES ?? "1440x960,1080x700,720x480").split(",").map(size => {
  const match = /^(\d+)x(\d+)$/.exec(size);
  assert.ok(match, `Invalid capture size: ${size}`);
  const [width, height] = match.slice(1).map(Number);
  assert.ok(width >= 720 && height >= 480 && width <= 3840 && height <= 2160, `Unsupported capture size: ${size}`);
  return { width, height };
});

function syntheticRoom() {
  const at = Date.UTC(2026, 10, 12, 7, 30);
  const members = [
    ["lead", "统筹员", "拆解需求、跟进交付", "foreman"],
    ["frontend", "前端", "界面与交互", "peer"],
    ["backend", "后端", "接口与数据", "peer"],
  ].map(([id, title, duty, role]) => ({ id, title, duty, role, tabId: `baseline-${id}`, agent: "codex", joinedAt: at - 3600000, leftAt: null }));
  const tasks = [
    ["T1", "统一设计令牌与视觉规范", "done", "frontend"],
    ["T2", "工作台布局与交互优化", "active", "frontend"],
    ["T3", "接口状态与数据兼容性检查", "active", "backend"],
    ["T4", "亮暗主题与紧凑窗口验收", "planned", "lead"],
  ].map(([id, title, status, assignee]) => ({ id, title, status, assignee, outcome: "检查亮暗主题、文本层级和键盘操作", blockedBy: [], notes: "使用合成数据进行界面验收", result: status === "done" ? "规范已确认" : null, createdBy: "lead", createdAt: at - 2400000, updatedAt: at - 300000, rev: 1 }));
  const messages = [
    ["user", "优化系统的 UI 设计，保持专业、清晰的工作台体验。", ["lead"]],
    ["lead", "设计规范已确认。前端完善工作台布局，后端检查接口与状态呈现。", ["user"]],
    ["frontend", "亮暗主题统一使用设计令牌，下一步检查设置与房间视图。", ["lead"]],
    ["backend", "接口契约保持兼容。截图使用合成样例，不连接真实服务。", ["lead"]],
  ].map(([by, text, to], index) => ({ id: `baseline-message-${index}`, at: at - (12 - index * 2) * 60000, kind: "chat", by, text, to, mode: "send", replyTo: null, deliveredTo: to.filter(id => id !== "user"), repliedBy: [], replyCancelled: false }));
  return { id: "baseline-room", name: "工作台设计优化", projectRoot: "/qa/synthetic-project", createdAt: at - 7200000, brief: { objective: "优化视觉层级与操作体验，保留终端和协作功能。", currentFocus: "统一工作台、设置和协作房间的视觉语言", constraints: ["保留现有接口契约", "覆盖亮暗主题与最小窗口"], updatedBy: "user", updatedAt: at - 1800000 }, members, tasks, messages, nextTask: 5, paused: false };
}

const room = syntheticRoom();
const extension = `
(() => {
  const RealDate = Date;
  const fixed = Date.UTC(2026, 10, 12, 7, 30);
  window.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  };
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ${JSON.stringify(platform === "macos" ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0.0.0 Safari/537.36" : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36")} });
  localStorage.setItem('belfry.theme.v1', 'dark');
  ${fontSize === null ? '' : `localStorage.setItem('belfry.typography.v1', ${JSON.stringify(JSON.stringify({ fontFamily: null, fontSize, activeImportedFont: null, importedFonts: [] }))});`}
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    document.head.append(style);
    const icon = document.createElement('link');
    icon.rel = 'icon'; icon.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
    document.head.append(icon);
  });
  const room = ${JSON.stringify(room)};
  const summary = { id: room.id, name: room.name, projectRoot: room.projectRoot, createdAt: room.createdAt, objective: room.brief.objective,
    memberCount: room.members.length, memberTabIds: room.members.map(m => m.tabId), memberTitles: room.members.map(m => m.title),
    foreman: '统筹员', openTasks: 3, doneTasks: 1, lastMessageAt: room.messages.at(-1).at, paused: false, lastToUser: null };
  const original = window.__TAURI_INTERNALS__.invoke;
  const handlers = {
    room_list: () => ({ rooms: [summary], loadError: null }),
    room_get: () => room,
    room_history: () => ({ entries: [], nextCursor: null, ledgerBytes: 0, snapshotBytes: 0 }),
    // Optional remote UI is present in the shared worktree; capture a local-only state.
    remote_link_status: () => ({ listening: false, nodeId: 'synthetic-baseline', relayUrl: null, peers: [] }),
    remote_guest_status: () => [],
  };
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    if (!handlers[command]) return original(command, args);
    __productionQA.calls.push({ command, args });
    return structuredClone(handlers[command](args));
  };
})();`;

test("capture production workbench, settings and rooms in both themes", { timeout: 180000 }, async t => {
  await mkdir(directory, { recursive: true });
  const { view, baseline, requests } = await uiFixture(t, { nativeExtension: extension });
  await view.send("Emulation.setTimezoneOverride", { timezoneId: "Asia/Shanghai" });
  const captures = [];
  for (const mode of ["dark", "light"]) {
    await resize(view, 1440, 960);
    await theme(view, mode);
    for (const size of sizes) {
      await resize(view, size.width, size.height);
      captures.push(await capture(view, "workbench", mode, size));
    }
    await resize(view, 1440, 960);
    await settings(view, "外观");
    await waitFor(view, "!!document.querySelector('.settings-content > *')");
    for (const size of sizes) {
      await resize(view, size.width, size.height);
      captures.push(await capture(view, "settings", mode, size));
    }
    await click(view, 'button[title="关闭设置"]');
    await waitFor(view, "!document.querySelector('.settings-view')");
    await resize(view, 1440, 960);
    await click(view, 'button[title^="协作房间"]');
    await waitFor(view, "!!document.querySelector('[aria-label=房间对话] article')");
    for (const size of sizes) {
      await resize(view, size.width, size.height);
      captures.push(await capture(view, "rooms", mode, size));
    }
    await resize(view, 1440, 960);
    await press(view, "Escape");
    await waitFor(view, "!document.querySelector('.room-view')");
    await intact(view, baseline);
  }
  assert.ok(requests.some(request => /\/assets\/index-.*\.js/.test(request.url)), "Capture must load the production bundle");
  assert.deepEqual(requests.filter(request => request.status >= 400), [], "All production resources must load");
  const html = await readFile("dist/index.html", "utf8");
  const manifest = {
    generatedAt: new Date().toISOString(), platform, browser: await view.process.send("Browser.getVersion"),
    source: { revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirtyPaths: execFileSync("git", ["status", "--short"], { encoding: "utf8" }).trim().split("\n") },
    productionAssets: await Promise.all([...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(async ([, path]) => ({ path, sha256: createHash("sha256").update(await readFile(join(project, "dist", path))).digest("hex") }))),
    syntheticNativeAdapter: true, realUserData: false, nativeWindowCaptured: false, fontSize, captures,
  };
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  t.diagnostic(`Saved ${captures.length} PNGs and manifest.json to ${directory}`);
});

async function capture(view, surface, mode, { width, height }) {
  await view.cdp.evaluate("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
  const geometry = await view.cdp.evaluate(`(() => {
    const selector = ${JSON.stringify(surface === "workbench" ? ".workbench" : surface === "settings" ? ".settings-view" : ".room-view")};
    const root = document.querySelector(selector), rect = root?.getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      theme: document.documentElement.dataset.theme, platform: document.documentElement.dataset.platform,
      surface: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      canvas: getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim(),
      themeColor: document.querySelector('meta[name="theme-color"]')?.content ?? null,
      alerts: [...document.querySelectorAll('[role="alert"]')].filter(el => el.getBoundingClientRect().height).map(el => el.textContent.trim()) };
  })()`);
  assert.ok(geometry.surface?.width > 0 && geometry.surface?.height > 0, `${surface}: missing visible surface`);
  assert.equal(geometry.theme, mode);
  assert.equal(geometry.platform, platform);
  assert.ok(geometry.scrollWidth <= width + 1, `${surface}: horizontal page overflow`);
  assert.deepEqual(geometry.alerts, [], `${surface}: capture contains an error alert`);
  const filename = `${surface}-${mode}-${width}x${height}.png`;
  const { data } = await view.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const png = Buffer.from(data, "base64");
  assert.equal(png.readUInt32BE(16), width, "PNG width matches viewport");
  assert.equal(png.readUInt32BE(20), height, "PNG height matches viewport");
  await writeFile(join(directory, filename), png);
  return { filename, sha256: createHash("sha256").update(png).digest("hex"), ...geometry };
}
