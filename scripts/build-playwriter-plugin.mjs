import "../plugins/playwriter/build/build-runtime.mjs";
import { check } from "../src-tauri/src/plugins/node/author.mjs";
import { fileURLToPath } from "node:url";
const result = await check(fileURLToPath(new URL("../plugins/playwriter/", import.meta.url)));
console.log(JSON.stringify({ ok: result.ok, pluginBytes: result.totalBytes, digest: result.digest }, null, 2));
