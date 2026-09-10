import assert from "node:assert/strict";
import test from "node:test";
import { installSelectionContents } from "../../src-tauri/src/plugins/node/selection-contents.mjs";

function fixture(source) {
  const requests = [];
  const contents = installSelectionContents({ invoke: async (api, input) => {
    assert.equal(api, "fs.readSelection"); requests.push(input);
    assert.equal(input.selectionId, "selected-token");
    return { bytes: source.slice(input.offset, input.offset + input.length), totalSize: source.length };
  } });
  const file = contents.attach(new File([], "日志.txt", { type: "text/plain" }), { selectionId: "selected-token", size: source.length, mtimeMs: 1700000000000 });
  return { file, requests, contents };
}

test("selected files expose real UTF-8 content, binary ranges and bounded streams", async () => {
  const text = "真实日志🔎\n".repeat(60_000), source = new TextEncoder().encode(text);
  const { file, requests } = fixture(source);
  assert.equal(file.size, source.length);
  assert.equal(file.lastModified, 1700000000000);
  assert.equal(await file.text(), text);
  assert.deepEqual(new Uint8Array(await file.slice(-17).arrayBuffer()), source.slice(-17));
  assert.deepEqual(new Uint8Array(await file.slice(4, 33).slice(2, 8).arrayBuffer()), source.slice(6, 12));
  const reader = file.stream().getReader(); let loaded = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; loaded += value.length; }
  assert.equal(loaded, source.length);
  assert.ok(requests.every((input) => input.length <= 256 * 1024));
});

test("large files can be streamed without eagerly materializing their content", async () => {
  const { contents, requests } = fixture(new Uint8Array());
  const file = contents.attach(new File([], "huge.log"), { selectionId: "selected-token", size: 1024 ** 3, mtimeMs: 0 });
  assert.equal(requests.length, 0);
  await assert.rejects(file.arrayBuffer(), { name: "NotReadableError" });
  assert.equal(requests.length, 0);
  assert.equal(file.slice(1, 11).size, 10);
});

test("eagerly loaded files preserve native Blob behavior", async () => {
  const { contents } = fixture(new Uint8Array());
  const file = contents.attach(new File(["native bytes"], "small.txt"), { selectionId: "selected-token", size: 12, mtimeMs: 1 });
  assert.equal(contents.isSelected(file), false);
  assert.equal(await new Response(file).text(), "native bytes");
});
