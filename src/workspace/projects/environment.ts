import { TranslationError } from "../../i18n";
import { MAX_COMMAND_LENGTH, MAX_ENVIRONMENT_ENTRIES, MAX_ENVIRONMENT_VALUE } from "./contracts";

const RESERVED = /^(HOME|USERPROFILE|SHELL|COMSPEC|SYSTEMROOT|WINDIR|TERM|COLORTERM|CODEX_HOME|CODEX_SQLITE_HOME|CLAUDE_CONFIG_DIR|BELFRY_.*|NODE_OPTIONS|BASH_ENV|ENV|ZDOTDIR|LD_.*|DYLD_.*)$/i;
const SENSITIVE = /(API_?KEY|TOKEN|SECRET|PASSW(OR)?D|PASSWORD|CREDENTIAL|PRIVATE_KEY|AUTHORIZATION|ACCESS_KEY)/i;
const SECRET_VALUE = /-----BEGIN [^-]*PRIVATE KEY-----|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export function validateEnvironment(env: unknown): Record<string, string> {
  if (!env || typeof env !== "object" || Array.isArray(env)) throw new TranslationError("workspace.environment.text_9ca6a9a218");
  const entries = Object.entries(env);
  if (entries.length > MAX_ENVIRONMENT_ENTRIES) throw new TranslationError("workspace.environment.text_d47de2bb8c", { max: MAX_ENVIRONMENT_ENTRIES });
  if (new Set(entries.map(([key]) => key.toUpperCase())).size !== entries.length) throw new TranslationError("workspace.environment.text_813dd82ff6");
  for (const [key, value] of entries) validateEntry(key, value);
  return Object.fromEntries(entries) as Record<string, string>;
}

function validateEntry(key: string, value: unknown) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || ["__proto__", "constructor", "prototype"].includes(key)) {
    throw new TranslationError("workspace.environment.text_ac1a4f8351", { key: key });
  }
  if (RESERVED.test(key)) throw new TranslationError("workspace.environment.text_8828914c4f", { key: key });
  if (SENSITIVE.test(key)) throw new TranslationError("workspace.environment.text_262dcf62d5", { key: key });
  if (typeof value !== "string" || value.length > MAX_ENVIRONMENT_VALUE || CONTROL.test(value)) {
    throw new TranslationError("workspace.environment.text_b6d1d78982", { key: key });
  }
  if (SECRET_VALUE.test(value)) throw new TranslationError("workspace.environment.text_b73701a73a", { key: key });
}

export function parseEnvironment(text: string): Record<string, string> {
  const entries: Array<[string, string]> = [];
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new TranslationError("workspace.environment.text_a8e8cc1f92");
    const name = line.slice(0, separator).trim();
    if (names.has(name.toUpperCase())) throw new TranslationError("workspace.environment.text_a0de311680", { name: name });
    names.add(name.toUpperCase());
    entries.push([name, line.slice(separator + 1)]);
  }
  return validateEnvironment(Object.fromEntries(entries));
}

export function formatEnvironment(env: Record<string, string>) {
  return Object.entries(env).map(([name, value]) => `${name}=${value}`).join("\n");
}

export function validateStartupCommand(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_COMMAND_LENGTH || CONTROL.test(value)) {
    throw new TranslationError("workspace.environment.text_68cebe0edb", { max: MAX_COMMAND_LENGTH });
  }
  if (SECRET_VALUE.test(value)) throw new TranslationError("workspace.environment.text_b28e046e67");
  return value.trim();
}
