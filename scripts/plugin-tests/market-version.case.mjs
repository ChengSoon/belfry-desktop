import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions } from "../../src-tauri/src/plugins/node/market-catalog.mjs";

test("market updates distinguish hyphenated prereleases and use SemVer identifier ordering", () => {
  const versions = ["1.0.0-1", "1.0.0-9007199254740992", "1.0.0-9007199254740993",
    "1.0.0-A", "1.0.0-a", "1.0.0-alpha-a", "1.0.0-alpha-b", "1.0.0-beta.1", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0"];
  for (let index = 1; index < versions.length; index++) {
    assert.ok(compareVersions(versions[index - 1], versions[index]) < 0, `${versions[index - 1]} < ${versions[index]}`);
    assert.ok(compareVersions(versions[index], versions[index - 1]) > 0);
  }
  assert.equal(compareVersions("1.0.0+first", "1.0.0+second"), 0);
});
