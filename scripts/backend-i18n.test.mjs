import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = process.env.BELFRY_I18N_FIXTURE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('NSIS includes both languages and translates every custom installer message', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.windows.conf.json'), 'utf8'));
  assert.deepEqual(config.bundle.windows.nsis.languages, ['English', 'SimpChinese']);
  assert.equal(config.bundle.windows.nsis.displayLanguageSelector, true);
  const hooks = await readFile(path.join(root, 'src-tauri/windows/installer-hooks.nsh'), 'utf8');
  const definitions = new Map();
  for (const [, name, language] of hooks.matchAll(/^LangString (\w+) (1033|2052) "/gm)) {
    if (!definitions.has(name)) definitions.set(name, new Set());
    definitions.get(name).add(language);
  }
  const used = [...hooks.matchAll(/(?:DetailPrint|Abort|MessageBox) [^\n]*"\$\((\w+)\)"/g)].map(match => match[1]);
  assert.ok(used.length >= 8, 'All custom installer messages must use a language resource');
  for (const name of used) assert.deepEqual([...definitions.get(name) || []].sort(), ['1033', '2052'], name);
  for (const line of hooks.split('\n').filter(line => /^\s*(?:DetailPrint|Abort|MessageBox)\s/.test(line))) {
    assert.match(line, /"\$\(Belfry\w+\)"/, `Untranslated installer message: ${line}`);
  }
});

test('backend error directory has stable codes and named, matching parameters', async () => {
  const directory = JSON.parse(await readFile(path.join(root, 'docs/backend-error-codes.json'), 'utf8'));
  const codes = new Set();
  const slots = text => [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]))].sort();
  for (const entry of directory.entries) {
    assert.match(entry.code, /^[A-Z][A-Z0-9_]+$/);
    assert.ok(!codes.has(entry.code), entry.code);
    codes.add(entry.code);
    assert.deepEqual(slots(entry.en), entry.params, entry.code);
    assert.deepEqual(slots(entry.zhCN), entry.params, entry.code);
    assert.ok(!entry.params.some(name => /^(?:p|value)\d+$/.test(name)), `${entry.code}: parameters must be named`);
    assert.doesNotMatch(entry.en, /[\p{Script=Han}]/u, `${entry.code}: English template contains Chinese`);
  }
});

test('history scan notices are complete alternatives with only a count parameter', async () => {
  const directory = JSON.parse(await readFile(path.join(root, 'docs/backend-error-codes.json'), 'utf8'));
  for (const code of ['HISTORY_SCAN_LIMIT_REACHED', 'HISTORY_THE_LOG_SCAN_MAY_BE_INCOMPLETE_UNREADABLE']) {
    const entry = directory.entries.find(entry => entry.code === code);
    assert.deepEqual(entry.params, ['count'], code);
    assert.match(entry.zhCN, /^日志扫描/u);
    assert.match(entry.en, /^The log scan /u);
    assert.doesNotMatch(entry.zhCN + entry.en, /\{\{limit\}\}/u);
  }
});
