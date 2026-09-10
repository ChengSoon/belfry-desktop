#!/usr/bin/env node
import { main } from "../src-tauri/src/plugins/node/cli.mjs";

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
