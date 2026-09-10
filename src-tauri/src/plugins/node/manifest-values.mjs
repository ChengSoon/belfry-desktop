export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)
  && !value.includes("..") && !value.endsWith(".");
export function required(value, label) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > 16_384 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error(`${label} 必须为有效非空字符串`);
  return value;
}
export function resourcePath(input) {
  const value = required(input, "资源路径").replace(/^(\.\/)+/, "");
  if (/[\\:\x00-\x1f]/.test(value) || value.split("/").some((part) => !part || part === "." || part === "..")) throw new Error(`资源路径必须位于插件目录内：${input}`);
  return value;
}
export function array(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} 必须为数组`);
  return value;
}
export function strings(value, label) {
  const values = array(value, label);
  values.forEach((item) => required(item, label));
  if (new Set(values).size !== values.length) throw new Error(`${label} 存在重复值`);
  return values;
}
