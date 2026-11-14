import { mkdtemp, mkdir, readdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { runtimeZip } from "../runtime-archive.mjs";
import { ENGINE_VERSION } from "../runtime.mjs";

const plugin = fileURLToPath(new URL("../", import.meta.url));
const supplied = process.argv.indexOf("--from");
const temporary = supplied < 0 ? await mkdtemp(join(tmpdir(), "belfry-playwriter-build-")) : null;
const source = temporary ?? resolve(process.argv[supplied + 1]);
function skipEntry(entry, name, optional) {
  return entry.isSymbolicLink() || [".bin", ".cache", "@img", "sharp"].includes(entry.name) || optional.has(name);
}
function includeFile(entry, name) {
  return entry.isFile() && !/\.(?:map|ts)$/.test(name) && !/\.(?:test|spec)\.[cm]?js$/.test(name)
    && !name.includes("/__snapshots__/") && entry.name !== ".package-lock.json";
}
try {
  if (temporary) {
    await cp(join(plugin, "build/package.json"), join(source, "package.json"));
    await cp(join(plugin, "build/package-lock.json"), join(source, "package-lock.json"));
    await new Promise((done, fail) => {
      const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--ignore-scripts", "--omit=optional", "--no-audit", "--no-fund"],
        { cwd: source, stdio: "inherit", shell: process.platform === "win32" });
      child.on("error", fail); child.on("exit", code => code === 0 ? done() : fail(new Error(`npm ci exited ${code}`)));
    });
  }
  const installed = JSON.parse(await readFile(join(source, "node_modules/playwriter/package.json"), "utf8"));
  if (installed.version !== ENGINE_VERSION) throw new Error(`需要 Playwriter ${ENGINE_VERSION}，实际为 ${installed.version}`);
  const lock = JSON.parse(await readFile(join(plugin, "build/package-lock.json"), "utf8"));
  const optional = new Set(Object.entries(lock.packages).filter(([, value]) => value.optional).map(([path]) => path));
  const files = new Map();
  async function visit(relative) {
    for (const entry of await readdir(join(source, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (skipEntry(entry, name, optional)) continue;
      if (entry.isDirectory()) await visit(name);
      else if (includeFile(entry, name)) files.set(name, await readFile(join(source, name)));
    }
  }
  await visit("node_modules");
  const bytes = runtimeZip(files);
  const metadata = { name: "playwriter", version: ENGINE_VERSION, sha256: createHash("sha256").update(bytes).digest("hex"),
    fileCount: files.size, totalBytes: [...files.values()].reduce((sum, body) => sum + body.length, 0), archiveBytes: bytes.length,
    source: "https://github.com/remorses/playwriter", license: "MIT", optionalNativeDependencies: false };
  await mkdir(join(plugin, "vendor"), { recursive: true });
  await writeFile(join(plugin, "vendor/runtime.zip"), bytes);
  await writeFile(join(plugin, "vendor/runtime.json"), JSON.stringify(metadata, null, 2) + "\n");
  console.log(JSON.stringify(metadata, null, 2));
} finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
