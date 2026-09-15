import { MAX_COMMAND_LENGTH, MAX_ENVIRONMENT_ENTRIES, MAX_ENVIRONMENT_VALUE } from "./contracts";

const RESERVED = /^(HOME|USERPROFILE|SHELL|COMSPEC|SYSTEMROOT|WINDIR|TERM|COLORTERM|CODEX_HOME|CODEX_SQLITE_HOME|CLAUDE_CONFIG_DIR|BELFRY_.*|OTTY_.*|NODE_OPTIONS|BASH_ENV|ENV|ZDOTDIR|LD_.*|DYLD_.*)$/i;
const SENSITIVE = /(API_?KEY|TOKEN|SECRET|PASSW(OR)?D|PASSWORD|CREDENTIAL|PRIVATE_KEY|AUTHORIZATION|ACCESS_KEY)/i;
const SECRET_VALUE = /-----BEGIN [^-]*PRIVATE KEY-----|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export function validateEnvironment(env: unknown): Record<string, string> {
  if (!env || typeof env !== "object" || Array.isArray(env)) throw new Error("环境变量格式无效");
  const entries = Object.entries(env);
  if (entries.length > MAX_ENVIRONMENT_ENTRIES) throw new Error(`环境变量最多 ${MAX_ENVIRONMENT_ENTRIES} 项`);
  if (new Set(entries.map(([key]) => key.toUpperCase())).size !== entries.length) throw new Error("环境变量名称重复");
  for (const [key, value] of entries) validateEntry(key, value);
  return Object.fromEntries(entries) as Record<string, string>;
}

function validateEntry(key: string, value: unknown) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || ["__proto__", "constructor", "prototype"].includes(key)) {
    throw new Error(`环境变量名称无效：${key}`);
  }
  if (RESERVED.test(key)) throw new Error(`${key} 是系统或 CLI 保留变量`);
  if (SENSITIVE.test(key)) throw new Error(`${key} 可能包含敏感凭据，请使用系统凭据库或 CLI 配置`);
  if (typeof value !== "string" || value.length > MAX_ENVIRONMENT_VALUE || CONTROL.test(value)) {
    throw new Error(`${key} 的值无效或过长`);
  }
  if (SECRET_VALUE.test(value)) throw new Error(`${key} 的值可能包含敏感凭据`);
}

export function parseEnvironment(text: string): Record<string, string> {
  const entries: Array<[string, string]> = [];
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("每行环境变量请使用 NAME=value 格式");
    const name = line.slice(0, separator).trim();
    if (names.has(name.toUpperCase())) throw new Error(`环境变量重复：${name}`);
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
    throw new Error(`启动命令应为单行，最多 ${MAX_COMMAND_LENGTH} 个字符`);
  }
  if (SECRET_VALUE.test(value)) throw new Error("启动命令不能包含敏感凭据");
  return value.trim();
}
