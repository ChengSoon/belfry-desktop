import { readFile, writeFile } from "node:fs/promises";

const source = JSON.parse(await readFile("docs/backend-error-codes.json", "utf8"));
// These are CLI sentence fragments, never error codes returned to a frontend command.
const cliLabels = new Set(["ROOM_ASSIGNED_TO", "ROOM_CURRENTLY_UNASSIGNED", "ROOM_WAITING_FOR_TO_FINISH", "ROOM_COMPLETION_CRITERIA", "ROOM_ATTACHMENTS_LOCAL_FILES_READ_AS_NEEDED"]);
const entries = source.entries.filter(entry => !source.fallbackOnly.includes(entry.code)
  && !cliLabels.has(entry.code) && !/^(CLI_|DIALOG_|NATIVE_(?!LOCALE_))/.test(entry.code));
for (const [locale, field] of [["zh-CN", "zhCN"], ["en", "en"]]) {
  const path = `src/i18n/locales/${locale}/errors.json`;
  const value = JSON.stringify(Object.fromEntries(entries.map(entry => [entry.code, entry[field].trim()])), null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (await readFile(path, "utf8").catch(() => "") !== value) throw new Error(`Backend translations changed: run pnpm sync:i18n (${locale})`);
  } else await writeFile(path, value);
}
console.log(`Synchronized ${entries.length} backend error/message codes.`);
