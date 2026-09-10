// D1 私有差异算法：输入必须已通过未来的有界 JSON/manifest 校验。
// 这里只计算展示差异，不决定版本替换、落盘或回退。
type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
type JsonObject = { readonly [key: string]: JsonValue };
type Entry = JsonObject & { readonly id: string };

export function diffContributions(input: { before: readonly Entry[]; after: readonly Entry[] }) {
  const before = indexEntries(input.before);
  const after = indexEntries(input.after);
  return {
    added: input.after.filter((entry) => !before.has(entry.id)).map((entry) => entry.id),
    removed: input.before.filter((entry) => !after.has(entry.id)).map((entry) => entry.id),
    changed: input.after.filter((entry) => {
      const previous = before.get(entry.id);
      return previous !== undefined && canonicalJson(previous) !== canonicalJson(entry);
    }).map((entry) => entry.id),
  };
}

function indexEntries(entries: readonly Entry[]) {
  const index = new Map(entries.map((entry) => [entry.id, entry]));
  if (index.size !== entries.length) throw new Error("差异快照中有重复 ID");
  return index;
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as JsonObject;
  const fields = Object.keys(object).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(object[key])}`
  ));
  return `{${fields.join(",")}}`;
}
