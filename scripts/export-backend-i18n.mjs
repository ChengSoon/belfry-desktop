import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await readFile(path.join(root, 'src-tauri/crates/belfry-i18n/catalog.json'), 'utf8'));
const generic = [
  { code: 'CONFLICT', zh: '状态已变更，请刷新后再操作。', en: 'The state has changed. Refresh before trying again.' },
  { code: 'SESSION_MISSING', zh: '原来的后台任务已不存在，请从历史继续或新建会话；没有自动重新执行。', en: 'The original background task no longer exists. Resume its history or start a new session; it has not been executed again automatically.' },
  { code: 'PROCESS_EXITED', zh: '终端会话已退出。', en: 'The terminal session has exited.' },
];
const frontend = text => text.replace(/(?<!\{)\{([A-Za-z_][A-Za-z0-9_]*)(?::[^{}]*)?\}(?!\})/g, '{{$1}}');
const entries = [...catalog, ...generic].map(entry => ({
  code: entry.code,
  params: [...new Set([...entry.en.matchAll(/(?<!\{)\{([A-Za-z_][A-Za-z0-9_]*)(?::[^{}]*)?\}(?!\})/g)].map(match => match[1]))].sort(),
  en: frontend(entry.en),
  zhCN: frontend(entry.zh),
}));
const output = `${JSON.stringify({
  schemaVersion: 1,
  source: 'src-tauri/crates/belfry-i18n/catalog.json',
  contract: '{code,message,retryable,params?:Record<string,string|number>}',
  note: 'The shared catalog also contains CLI, notification, and native UI text. Codes are stable. Frontend keys use errors.<code>; both templates below use {{named}} interpolation. Generic categories without a catalog match retain an English message fallback.',
  fallbackOnly: ['INVALID_ARGUMENT','NOT_FOUND','UNSUPPORTED','PERMISSION_DENIED','TIMEOUT','IO_ERROR','ADAPTER_ERROR','CONFIRMATION_REQUIRED'],
  entries,
}, null, 2)}\n`;
const target = path.join(root, 'docs/backend-error-codes.json');
if (process.argv.includes('--check')) {
  const actual = (await readFile(target, 'utf8')).replace(/\r\n/g, '\n');
  if (actual !== output) throw new Error('Backend error directory is stale. Run node scripts/export-backend-i18n.mjs.');
} else {
  await writeFile(target, output);
  process.stdout.write(`Exported ${entries.length} stable catalog codes to docs/backend-error-codes.json\n`);
}
