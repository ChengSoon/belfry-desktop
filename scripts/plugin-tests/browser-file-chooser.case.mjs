import assert from "node:assert/strict";
import test from "node:test";
import { BrowserFileChooser } from "../../src-tauri/src/plugins/node/browser-files.mjs";

test("late browser picker results are discarded after navigation, revocation or close", async (t) => {
  for (const reason of ["navigation", "revoked", "closed"]) await t.test(reason, async () => {
    const calls = [];
    let active = true, selected, opened;
    const entered = new Promise((resolve) => { opened = resolve; });
    const target = { closed: false, send: async (api) => {
      calls.push(api); return { node: { nodeName: "INPUT", attributes: ["type", "file"] } };
    } };
    const chooser = new BrowserFileChooser(target, {
      active: () => active,
      pickFiles: () => { opened(); return new Promise((resolve) => { selected = resolve; }); },
      reportError: (error) => { throw error; },
    });
    const pending = chooser.choose({ backendNodeId: 1, frameId: "frame", mode: "selectSingle" });
    await entered;
    if (reason === "navigation") chooser.event("Page.frameNavigated", { frame: { id: "frame" } });
    if (reason === "revoked") active = false;
    if (reason === "closed") target.closed = true;
    selected(["/must-not-read-after-revocation"]);
    await pending;
    assert.deepEqual(["DOM.describeNode"], calls);
  });
});
