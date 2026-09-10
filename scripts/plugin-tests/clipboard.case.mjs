import assert from "node:assert/strict";
import test from "node:test";
import { host, plugin, temporary } from "./support.mjs";

async function fixture(t, permissions = ["clipboard.read", "clipboard.write"]) {
  const root = await temporary(t), runtime = await host(t, root);
  const entry = await plugin(root, "mine.clipboard", { code: `module.exports.onLoad = () => pi.agent.registerTool({ name: "clipboard", description: "Clipboard",
    execute: async ({text}) => { if(text !== undefined) await pi.clipboard.writeText(text);
      return (await pi.clipboard.getHistory()).map(item=>item.type==='text' ? item : {...item, data: undefined, typed: item.data instanceof Uint8Array, length:item.data.length, first: item.data[0], last: item.data.at(-1)});
    } });`, manifest: { permissions: ["agent.tool.register", ...permissions], contributes: { agentTools: [{ name: "clipboard", description: "Clipboard" }] } } });
  await runtime.call("load", entry);
  const read = (args = {}) => runtime.call("tool", { pluginId: entry.manifest.id, name: "clipboard", args });
  return { runtime, read };
}
test("explicit host writes and pastes populate clipboard history without polling", async (t) => {
  const { runtime, read } = await fixture(t);
  assert.deepEqual(await read(), []);
  await read({ text: "copied by plugin" });
  await runtime.call("clipboard.capture.text", { text: "user paste" });
  await runtime.call("clipboard.capture.text", { text: "user paste" });
  const history = await read();
  assert.deepEqual(history.map(item=>item.text), ["user paste", "copied by plugin"]);
  assert.ok(history.every(item => !Number.isNaN(Date.parse(item.capturedAt))));
});
test("large clipboard images are transported in chunks and revived as Uint8Array", async (t) => {
  const { runtime, read } = await fixture(t);
  const bytes = Buffer.alloc(2 * 1024 * 1024, 123); bytes[0] = 137; bytes[bytes.length - 1] = 51;
  const { id } = await runtime.call("clipboard.capture.begin", { format: "png", size: bytes.length, width: 100, height: 200 });
  const chunkSize = 128 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    await runtime.call("clipboard.capture.chunk", { id, offset, data: bytes.subarray(offset, offset + chunkSize).toString("base64") });
  }
  await runtime.call("clipboard.capture.finish", { id });
  const [image] = await read();
  assert.equal(image.typed, true); assert.equal(image.length, bytes.length);
  assert.equal(image.first, 137); assert.equal(image.last, 51);
  assert.equal(image.width, 100); assert.equal(image.height, 200);
});
test("clipboard history requires permission and rejects incomplete image capture", async (t) => {
  const { runtime, read } = await fixture(t, []);
  await assert.rejects(read(), { code: "PERMISSION_DENIED" });
  const { id } = await runtime.call("clipboard.capture.begin", { format: "png", size: 100, width: 1, height: 1 });
  await assert.rejects(runtime.call("clipboard.capture.finish", { id }), { code: "INVALID_ARGUMENT" });
});

test("explicit clipboard reads retain the current text in history", async (t) => {
  const root = await temporary(t);
  const runtime = await host(t, root, { platform: ({ api }) => api === "clipboard.readText" ? "external copy" : null });
  const entry = await plugin(root, "mine.read-clipboard", { code: `module.exports.onLoad = () => pi.agent.registerTool({
    name: "read", description: "Read", execute: async () => {
      const text = await pi.clipboard.readText();
      return { text, history: (await pi.clipboard.getHistory()).map(item => item.text) };
    }
  });`, manifest: { permissions: ["agent.tool.register", "clipboard.read"] } });
  await runtime.call("load", entry);
  assert.deepEqual(await runtime.call("tool", { pluginId: entry.manifest.id, name: "read" }), {
    text: "external copy", history: ["external copy"],
  });
});
