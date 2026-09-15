import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const PROCESS_TIMEOUT = 60_000;

function packageManifest(version) {
  return `[package]\nname = "belfry-cli"\nversion = "${version}"\nedition = "2021"\n\n[[bin]]\nname = "belfry"\npath = "src/main.rs"\n`;
}

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "belfry-sidecar-lock-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const tauriDir = join(root, "src-tauri"), manifest = join(tauriDir, "cli", "Cargo.toml");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(tauriDir, "cli", "src"), { recursive: true });
  copyFileSync(new URL("./bundle-cli.mjs", import.meta.url), join(root, "scripts", "bundle-cli.mjs"));
  writeFileSync(join(tauriDir, "Cargo.toml"), '[workspace]\nmembers = ["cli"]\nresolver = "2"\n');
  writeFileSync(manifest, packageManifest("0.1.0"));
  writeFileSync(join(tauriDir, "cli", "src", "main.rs"), 'fn main() { println!("sidecar fixture"); }\n');
  const env = { ...process.env, CARGO_NET_OFFLINE: "true", CARGO_TARGET_DIR: join(tauriDir, "target") };
  delete env.TAURI_ENV_TARGET_TRIPLE;
  delete env.CARGO_BUILD_TARGET;
  const fixture = { root, tauriDir, manifest, env, lock: join(tauriDir, "Cargo.lock") };
  const generated = run(fixture, "cargo", ["generate-lockfile", "--offline"]);
  assert.equal(0, generated.status, generated.stderr);
  return fixture;
}

function run(fixture, command, args) {
  const result = spawnSync(command, args, { cwd: fixture.tauriDir, env: fixture.env,
    encoding: "utf8", timeout: PROCESS_TIMEOUT });
  if (result.error) throw result.error;
  return result;
}

function sidecar(fixture, debug) {
  return run({ ...fixture, env: { ...fixture.env, TAURI_ENV_DEBUG: String(debug) } },
    process.execPath, [join(fixture.root, "scripts", "bundle-cli.mjs")]);
}

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("sidecar builds and copies a real host executable without changing a current lock", (t) => {
  const fixture = workspace(t), before = readFileSync(fixture.lock);
  const result = sidecar(fixture, true);
  assert.equal(0, result.status, result.stderr);
  assert.deepEqual(before, readFileSync(fixture.lock));
  const triple = run(fixture, "rustc", ["-vV"]).stdout.match(/^host: (.+)$/m)?.[1];
  assert.ok(triple, "rustc must report its host target");
  const suffix = triple.includes("windows") ? ".exe" : "";
  const target = join(fixture.tauriDir, "binaries", `belfry-${triple}${suffix}`);
  const built = join(fixture.tauriDir, "target", "debug", `belfry${suffix}`);
  assert.deepEqual(readFileSync(built), readFileSync(target));
  const executed = run(fixture, target, []);
  assert.equal(0, executed.status, executed.stderr);
  assert.equal("sidecar fixture", executed.stdout.trim());
});

for (const debug of [true, false]) {
  test(`sidecar ${debug ? "debug" : "release"} rejects an outdated lock without rewriting any bytes`, (t) => {
    const fixture = workspace(t);
    writeFileSync(fixture.manifest, packageManifest("0.2.0"));
    const before = readFileSync(fixture.lock);
    const result = sidecar(fixture, debug), after = readFileSync(fixture.lock);
    t.diagnostic(JSON.stringify({ mode: debug ? "debug" : "release", status: result.status,
      before: digest(before), after: digest(after) }));
    assert.notEqual(0, result.status, "sidecar preparation must reject an outdated lock");
    assert.match(result.stderr, /--locked/, "failure must come from Cargo's lock check");
    assert.deepEqual(before, after, "Cargo.lock must remain byte-for-byte unchanged");
    assert.equal(false, existsSync(join(fixture.tauriDir, "binaries")), "failed preparation must not publish a sidecar");
  });
}
