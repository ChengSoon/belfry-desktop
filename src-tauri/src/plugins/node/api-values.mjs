export function reviveApiValue(api, value) {
  if (["fs.readRange", "fs.readSelection"].includes(api) && value?.bytes != null) return {
    bytes: typeof value.bytes === "string" ? Uint8Array.from(atob(value.bytes), (character) => character.charCodeAt(0)) : new Uint8Array(value.bytes),
    totalSize: value.totalSize,
  };
  if (api === "clipboard.getHistory" && Array.isArray(value)) return value.map((item) =>
    item.type === "image" ? { ...item, data: new Uint8Array(item.data) } : item);
  return value;
}
