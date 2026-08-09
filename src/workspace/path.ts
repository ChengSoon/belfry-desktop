/** 把用户主目录折叠成 ~，路径只保留可辨识的尾部信息。 */
export function shortPath(path: string | null | undefined): string {
  if (!path) return "";
  return path
    .replace(/^\/(?:Users|home)\/[^/]+/, "~")
    .replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");
}
