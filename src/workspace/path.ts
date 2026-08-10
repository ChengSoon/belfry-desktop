/**
 * 后端 canonicalize 出来的 Windows 路径曾带 `\\?\` verbatim 前缀。
 * 现在后端已经剥掉，但 localStorage 里的历史条目还留着，展示前统一清理一次。
 */
export function normalizePath(path: string): string {
  const verbatim = /^\\\\\?\\(UNC\\)?/.exec(path);
  if (!verbatim) return path;
  // `\\?\UNC\server\share` 的普通形式是 `\\server\share`，主机段前要留住双反斜杠。
  return verbatim[1] ? `\\\\${path.slice(verbatim[0].length)}` : path.slice(verbatim[0].length);
}

/** 把用户主目录折叠成 ~，路径只保留可辨识的尾部信息。 */
export function shortPath(path: string | null | undefined): string {
  if (!path) return "";
  return normalizePath(path)
    .replace(/^\/(?:Users|home)\/[^/]+/, "~")
    .replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");
}

/**
 * 同一目录的去重键。
 * Windows 上盘符大小写与分隔符写法都可能不同，却指向同一个目录，
 * 不归一就会在「最近项目」里占两个槽位。
 */
export function pathKey(path: string): string {
  const normalized = normalizePath(path).replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:/.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}
