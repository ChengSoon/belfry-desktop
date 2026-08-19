import type { ProjectEntry } from "./contracts";

export function parentPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function filterEntries(entries: readonly ProjectEntry[], query: string) {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [...entries];
  return entries.filter((entry) => entry.name.toLocaleLowerCase().includes(term));
}

/** 把终端里的绝对路径、file:// URI 或相对路径收敛为项目根目录内的相对路径。 */
export function projectRelativePath(rootPath: string, candidate: string) {
  const root = normalizePath(rootPath);
  const decoded = decodeFileUri(candidate.trim());
  if (!root || !decoded) return null;

  const target = isAbsolutePath(decoded)
    ? normalizePath(decoded)
    : normalizePath(root === "/" ? `/${decoded}` : `${root}/${decoded}`);
  const insensitive = isWindowsPath(root) || root.startsWith("//");
  const comparableRoot = insensitive ? root.toLowerCase() : root;
  const comparableTarget = insensitive ? target.toLowerCase() : target;
  const rootPrefix = comparableRoot === "/" ? "" : `${comparableRoot}/`;
  if (!comparableTarget.startsWith(rootPrefix) || comparableTarget === comparableRoot) return null;
  return target.slice(root === "/" ? 1 : root.length + 1) || null;
}

function decodeFileUri(value: string) {
  if (!value.toLocaleLowerCase().startsWith("file://")) return value;
  try {
    const url = new URL(value);
    let path = decodeURIComponent(url.pathname);
    if (url.hostname) path = `//${url.hostname}${path}`;
    if (/^\/[A-Za-z]:\//u.test(path)) path = path.slice(1);
    return path;
  } catch {
    return "";
  }
}

function normalizePath(value: string) {
  const slashes = value.replace(/\\/gu, "/");
  const prefix = pathPrefix(slashes);
  const rest = prefix ? slashes.slice(prefix.length) : slashes;
  const segments: string[] = [];
  for (const segment of rest.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const joined = segments.join("/");
  if (prefix === "/" || prefix === "//") return `${prefix}${joined}`;
  if (prefix) return joined ? `${prefix}/${joined}` : prefix;
  return joined;
}

function pathPrefix(value: string) {
  const drive = /^[A-Za-z]:/u.exec(value)?.[0];
  if (drive) return drive;
  if (value.startsWith("//")) return "//";
  return value.startsWith("/") ? "/" : "";
}

function isAbsolutePath(value: string) {
  return value.startsWith("/") || value.startsWith("\\") || isWindowsPath(value);
}

function isWindowsPath(value: string) {
  return /^[A-Za-z]:(?:[\\/]|$)/u.test(value);
}
