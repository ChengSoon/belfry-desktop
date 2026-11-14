import { createServer } from "node:http";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readDirectory } from "../../src-tauri/src/plugins/node/directory.mjs";

// Use the real plugin on a private port so installed Playwriter connections do
// not affect regression results. Only the temporary entry point is configured.
export async function isolatedPlugin(root) {
  const server = createServer();
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  const port = server.address().port;
  await new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
  const path = join(root, "plugin");
  await cp(resolve(process.env.BELFRY_PLAYWRITER_PLUGIN_DIR ?? "plugins/playwriter"), path, { recursive: true });
  const entry = join(path, "main.mjs"), source = await readFile(entry, "utf8");
  const factory = "createController({ dataPath:";
  if (!source.includes(factory)) throw new Error("Playwriter fixture cannot configure its controller port");
  await writeFile(entry, source.replaceAll(factory, `createController({ port: ${port}, dataPath:`));
  return { plugin: await readDirectory(path), port };
}

export async function isolatedExtension(engine, root, port) {
  const path = join(root, "extension");
  await cp(join(engine, "node_modules/playwriter/dist/extension"), path, { recursive: true });
  const entry = join(path, "background.js"), source = await readFile(entry, "utf8");
  const setting = 'const RELAY_PORT = Number("19988") || 19988;';
  if (!source.includes(setting)) throw new Error("Playwriter fixture cannot configure its extension port");
  await writeFile(entry, source.replace(setting, `const RELAY_PORT = ${port};`));
  return path;
}
