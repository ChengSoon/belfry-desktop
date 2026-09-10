import assert from "node:assert/strict";
import { writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { mcpRequest } from "./mcp-support.mjs";
import { capturePage, originalPlugin, pageReady, upstreamPath } from "./upstream-support.mjs";

test("unmodified PI Browser page and dynamic tool share one visible guest and return MCP images", async (t) => {
  const path = upstreamPath(t, "pi.browser"); if (!path) return;
  const { workspace, runtime, view } = await originalPlugin(t, { path,
    prepare: (workspace) => writeFile(join(workspace, "index.html"), '<!doctype html><title>Original PI guest</title><h1>原版 Browser 互操作</h1><input aria-label="Note">') });
  assert.equal(await pageReady(view, "document.querySelector('#url')?.placeholder.includes('网址')"), true);
  const session = await runtime.call("session.open", { workspace, sessionId: "interop" });
  const tools = (await mcpRequest(session, { method: "tools/list" })).data.result.tools;
  const tool = tools.find((tool) => tool.description.includes("via CDP")); assert.ok(tool);
  const call = (args) => mcpRequest(session, { method: "tools/call", params: { name: tool.name, arguments: args } });
  const navigated = (await call({ action: "navigate", url: "index.html" })).data.result;
  assert.equal(navigated.isError, undefined);
  assert.equal(JSON.parse(navigated.content[0].text).state.title, "Original PI guest");
  assert.equal(await pageReady(view, "document.querySelector('[role=application] img')?.naturalWidth > 0 && !document.querySelector('[role=application]').hidden"), true);
  assert.match(await view.cdp.evaluate("document.querySelector('#url').value"), /index\.html/);
  const screenshot = (await call({ action: "screenshot" })).data.result;
  assert.ok(screenshot.content.some((block) => block.type === "image" && block.mimeType === "image/jpeg"));
  await capturePage(view, "original-browser");
});

test("unmodified Git Lens renders and reads the current workspace through its panel channels", async (t) => {
  const path = upstreamPath(t, "pi.gitlens"); if (!path) return;
  const { workspace, view, runtime, events } = await originalPlugin(t, { path, prepare: async (workspace) => {
    const git = (args) => promisify(execFile)("git", ["-C", workspace, "-c", "user.name=Plugin Test", "-c", "user.email=fixture@example.invalid",
      "-c", "commit.gpgSign=false", "-c", `core.hooksPath=${join(workspace, "no-hooks")}`, ...args]);
    await git(["init", "--quiet", "--template=", "--initial-branch=main"]);
    await writeFile(join(workspace, "README.md"), "Temporary Git Lens test repository\n");
    await git(["add", "README.md"]); await git(["commit", "--quiet", "-m", "test: 初始化临时插件验证仓库"]);
    await writeFile(join(workspace, "interop-note.txt"), "Git Lens fixture\n");
  } });
  const state = await view.cdp.evaluate("pluginBridge.invoke('git.state',{})").catch(async (error) => {
    t.diagnostic(JSON.stringify({ events, catalog: await runtime.call("catalog"), console: view.cdp.console() })); throw error;
  });
  assert.equal(state.repoRoot, await realpath(workspace));
  const status = await view.cdp.evaluate("pluginBridge.invoke('git.status',{})");
  assert.ok(JSON.stringify(status).includes("interop-note.txt"));
  await view.cdp.evaluate("document.querySelector('.tab[data-view=diff]').click()");
  assert.equal(await pageReady(view, "document.body.innerText.includes('interop-note.txt')"), true,
    await view.cdp.evaluate("document.body.innerText"));
  await capturePage(view, "original-gitlens");
});

test("unmodified Log Viewer opens a selected log and displays bytes through the host file bridge", async (t) => {
  const path = upstreamPath(t, "pi.log-viewer"); if (!path) return;
  let file;
  const { view, events } = await originalPlugin(t, { path, prepare: async (workspace) => {
    file = join(workspace, "interop.log");
    await writeFile(file, "2026-09-10 INFO original-plugin-interop\n2026-09-10 ERROR example-only\n");
  }, platform: ({ api }) => api === "fs.pickFiles" ? [file] : null });
  const buttons = await view.cdp.evaluate("Array.from(document.querySelectorAll('button')).map(button=>({text:button.innerText,title:button.title}))");
  assert.ok(buttons.some((button) => /打开|Open/.test(button.text + button.title)), JSON.stringify(buttons));
  await view.cdp.evaluate("Array.from(document.querySelectorAll('button')).find(button=>/打开文件|Open files|Open file/.test(button.innerText+' '+button.title)).click()");
  await capturePage(view, "original-log-viewer");
  assert.equal(await pageReady(view, "document.body.innerText.includes('original-plugin-interop')"), true,
    JSON.stringify({ body: await view.cdp.evaluate("document.body.innerText"), events, console: view.cdp.console() }));
});
