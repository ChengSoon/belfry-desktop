import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { compareDirectories, pairCaptures, pixelDifference, renderReport } from "./compare-ui-baseline.mjs";

test("pixel percentages and bounds count pixels once, including alpha, and respect the channel threshold", () => {
  const data = [0, 0, 0, 255, 20, 30, 40, 255, 90, 80, 70, 255, 255, 255, 255, 255];
  const after = [...data];
  after[4] += 2; after[5] += 3; // One pixel with two changed channels.
  after[15] = 250; // A second changed pixel: alpha only.
  const baseline = { width: 2, height: 2, data };
  const exact = pixelDifference(baseline, { ...baseline, data: after });
  assert.equal(exact.changedPixels, 2);
  assert.equal(exact.changedPercent, 50);
  assert.deepEqual(exact.bounds, { x: 1, y: 0, width: 1, height: 2 });
  assert.equal(exact.meanAbsoluteChannelDifference, 10 / 16);
  const threshold = pixelDifference(baseline, { ...baseline, data: after }, 3);
  assert.equal(threshold.changedPixels, 1);
  assert.equal(threshold.changedPercent, 25);
  assert.equal(threshold.exactChangedPercent, 50);
  assert.deepEqual(threshold.bounds, { x: 1, y: 1, width: 1, height: 1 });
  assert.deepEqual(Array.from(threshold.overlay.slice(12)), [239, 48, 92, 255]);
  assert.equal(pixelDifference(baseline, baseline).bounds, null);
  assert.throws(() => pixelDifference(baseline, { width: 1, height: 1, data: [0, 0, 0, 255] }), /dimensions differ/);
  assert.throws(() => pixelDifference(baseline, baseline, -1), /Threshold/);
});

test("manifest pairing detects absent, extra and duplicate captures without silently dropping them", () => {
  const capture = filename => ({ filename, width: 2, height: 2, theme: "dark" });
  const before = { platform: "macos", captures: [capture("one.png"), capture("missing.png")] };
  const after = { platform: "macos", captures: [capture("one.png"), capture("added.png")] };
  assert.deepEqual(pairCaptures(before, after).map(pair => [pair.filename, !!pair.before, !!pair.after]), [
    ["added.png", false, true], ["missing.png", true, false], ["one.png", true, true],
  ]);
  assert.throws(() => pairCaptures(before, { ...after, platform: "windows" }), /Platform mismatch/);
  assert.throws(() => pairCaptures(before, { ...after, captures: [capture("one.png"), capture("one.png")] }), /duplicate/);
});

test("real PNG decoding produces a 25% diff, reports missing files, and rejects stale manifest hashes", { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "belfry-ui-diff-case-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = join(root, "before"), after = join(root, "after"), output = join(root, "report");
  await Promise.all([mkdir(before), mkdir(after)]);
  // Independently encoded RGBA PNGs: 2x2 black; then only the top-left pixel red.
  const black = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR4nGNgYGD4D8UQBgAd9AP9yOH2qAAAAABJRU5ErkJggg==", "base64");
  const red = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8AARGAMYQAALuME/AevMqkAAAAASUVORK5CYII=", "base64");
  const capture = (filename, data) => ({ filename, width: 2, height: 2, theme: "dark", sha256: createHash("sha256").update(data).digest("hex") });
  await writeFile(join(before, "one.png"), black); await writeFile(join(after, "one.png"), red);
  await writeFile(join(before, "stale.png"), black); await writeFile(join(after, "stale.png"), red);
  await writeFile(join(before, "manifest.json"), JSON.stringify({ platform: "macos", captures: [capture("one.png", black), capture("missing.png", black), capture("stale.png", black)] }));
  await writeFile(join(after, "manifest.json"), JSON.stringify({ platform: "macos", captures: [capture("one.png", red), capture("stale.png", black)] }));
  const result = await compareDirectories(before, after, output);
  assert.equal(result.paired, 1);
  assert.equal(result.incomplete, 2);
  assert.equal(result.changedPixels, 1);
  assert.equal(result.changedPercent, 25);
  const changed = result.results.find(entry => entry.filename === "one.png");
  assert.deepEqual(changed.bounds, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(result.results.find(entry => entry.filename === "missing.png").status, "missing-after");
  assert.match(result.results.find(entry => entry.filename === "stale.png").error, /hash/);
  const html = await readFile(join(output, "index.html"), "utf8");
  assert.ok(html.includes("data:image/png;base64,"));
  assert.match(html, /25\.00000%/);
  assert.equal((await readFile(join(output, "diffs", "1.png"))).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("report escapes manifest text rather than treating filenames as markup", () => {
  const html = renderReport({ platform: "macos", threshold: 0, paired: 0, changed: 0, identical: 0, incomplete: 1, changedPercent: null, warnings: [], results: [{ filename: '<img src=x onerror="alert(1)">.png', status: "missing-after" }] }, []);
  assert.ok(!html.includes('<img src=x onerror="alert(1)">'));
  assert.ok(html.includes("&lt;img src=x"));
});
