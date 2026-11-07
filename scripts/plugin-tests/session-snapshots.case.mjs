import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { host, temporary, waitFor } from "./support.mjs";
import { resolveSnapshotIdentity, snapshotTabId } from "../../src-tauri/src/plugins/node/session-identity.mjs";

const primary = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const child = "33333333-3333-4333-8333-333333333333";

async function fixture(t) {
  const root = await temporary(t), workspace = join(root, "workspace"), historyRoot = join(root, "sessions"), snapshots = join(root, "shell_snapshots");
  await Promise.all([mkdir(workspace), mkdir(historyRoot), mkdir(snapshots)]);
  const context = { workspace, historyRoot, agentKind: "codex", tabId: "tab-a" };
  const snapshot = (id) => join(snapshots, `${id}.123.sh`);
  const write = async (id, { tab = "tab-a", cwd = workspace, source = "cli", metadata = true } = {}) => {
    await writeFile(snapshot(id), `# functions and environment\nexport PRIVATE_EXAMPLE_TOKEN=do-not-publish\nexport BELFRY_TAB_ID='${tab}'\n`);
    if (metadata) await writeFile(join(historyRoot, `rollout-2026-${id}.jsonl`), JSON.stringify({ type: "session_meta", payload: { id, cwd, source } }) + "\n");
  };
  return { root, context, snapshots, snapshot, write };
}

test("only literal exported tab assignments are accepted; snapshot commands are never evaluated", () => {
  for (const text of ["export BELFRY_TAB_ID=tab-a", "declare -x BELFRY_TAB_ID=\"tab-a\"", "typeset -x BELFRY_TAB_ID='tab-a'", "$env:BELFRY_TAB_ID = 'tab-a'"]) {
    assert.equal(snapshotTabId(text), "tab-a");
  }
  for (const text of ["echo export BELFRY_TAB_ID=tab-a", "export BELFRY_TAB_ID=$(echo tab-a)", "export BELFRY_TAB_ID='tab-a'; run-command", "export BELFRY_TAB_ID=tab-a\nexport BELFRY_TAB_ID=tab-b"]) {
    assert.equal(snapshotTabId(text), null);
  }
});

test("snapshot identity is matched by tab and verified as a primary CLI conversation in the same project", async (t) => {
  const f = await fixture(t);
  await f.write(primary);
  await f.write(other, { tab: "tab-b" });
  await f.write(child, { source: { subagent: { parent_thread_id: primary } } });
  assert.deepEqual(await resolveSnapshotIdentity(f.context), { agent: "codex", id: primary });
  assert.deepEqual(await resolveSnapshotIdentity({ ...f.context, tabId: "tab-b" }), { agent: "codex", id: other });
  assert.equal(await resolveSnapshotIdentity({ ...f.context, workspace: f.root }), null);
  assert.equal(await resolveSnapshotIdentity({ ...f.context, tabId: "missing" }), null);
});

test("multiple primary matches and incomplete transcripts fail closed instead of choosing the newest", async (t) => {
  const f = await fixture(t);
  await f.write(primary); await f.write(other);
  assert.equal(await resolveSnapshotIdentity(f.context), null);
  await rm(f.snapshot(other));
  await f.write(child, { metadata: false });
  assert.equal(await resolveSnapshotIdentity(f.context), null);
  await rm(f.snapshot(child));
  assert.deepEqual(await resolveSnapshotIdentity(f.context), { agent: "codex", id: primary });
  await writeFile(f.snapshot(primary), "export BELFRY_TAB_ID=tab-b\n");
  assert.equal(await resolveSnapshotIdentity(f.context), null);
});

test("oversized snapshots and symlinked entries are not read as identities", async (t) => {
  const f = await fixture(t);
  await f.write(primary);
  await writeFile(f.snapshot(primary), "x".repeat(1024 * 1024 + 1) + "\nexport BELFRY_TAB_ID=tab-a\n");
  assert.equal(await resolveSnapshotIdentity(f.context), null);
  await rm(f.snapshot(primary));
  const outside = join(f.root, "outside.sh"); await writeFile(outside, "export BELFRY_TAB_ID=tab-a\n");
  await symlink(outside, f.snapshot(primary));
  assert.equal(await resolveSnapshotIdentity(f.context), null);
});

test("existing sessions resolve before launch and fresh sessions publish identity without any MCP tool call", async (t) => {
  const f = await fixture(t), events = [];
  await f.write(primary);
  const runtime = await host(t, f.root, { event: (event) => { if (event.name === "sessionIdentity") events.push(event); } });
  const restored = await runtime.call("session.open", { ...f.context, sessionId: "restored-ticket" });
  assert.deepEqual(restored.agentSession, { agent: "codex", id: primary });
  const fresh = await runtime.call("session.open", { ...f.context, tabId: "tab-b", sessionId: "fresh-ticket" });
  assert.equal(fresh.agentSession, null);
  await f.write(other, { tab: "tab-b" });
  assert.ok(await waitFor(() => events.some((event) => event.sessionId === "fresh-ticket")));
  assert.deepEqual(events.find((event) => event.sessionId === "fresh-ticket").session, { agent: "codex", id: other });
  assert.ok(!JSON.stringify(events).includes("PRIVATE_EXAMPLE_TOKEN"));
  assert.ok(!JSON.stringify(events).includes("do-not-publish"));
});
