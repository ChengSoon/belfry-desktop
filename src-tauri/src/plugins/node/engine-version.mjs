// 移植目标：PI-Desktop 0.14.6-rc.3 的插件协议。
export const PI_API_VERSION = "0.14.6";
const CURRENT = PI_API_VERSION.split(".").map(Number);
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
export function validateVersion(value) {
  const match = typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match || match.slice(1, 4).some((part) => Number(part) > 65535)) throw new Error("插件版本无效");
  for (const [index, suffix] of match.slice(4).entries()) {
    if (suffix?.split(".").some((part) => !part || index === 0 && /^0\d+$/.test(part))) throw new Error("插件版本后缀无效");
  }
}
export function matchesVersionRange(range, field = "engines.piDesktop") {
  if (typeof range !== "string" || !range.trim() || range.length > 128) throw new Error(`${field} 必须为版本范围`);
  return range.split("||").map((group) => group.trim().split(/\s+/).map((token) => tokenMatches(token, field)).every(Boolean)).some(Boolean);
}
function tokenMatches(token, field) {
  const match = /^(>=|<=|>|<|=|\^|~)?v?([0-9xX*]+(?:\.[0-9xX*]+){0,2})$/.exec(token);
  if (!match) throw new Error(`不支持的 ${field} 范围：${token}`);
  const [, operator = "=", source] = match, parts = source.split(".");
  const wildcard = parts.some((part) => /^[xX*]$/.test(part));
  if (wildcard && operator !== "=") throw new Error("通配版本不能使用比较运算符");
  if (parts.some((part) => !/^[xX*]$/.test(part) && (!/^(0|[1-9]\d*)$/.test(part) || Number(part) > 65535))) throw new Error("版本格式无效");
  const version = Array.from({ length: 3 }, (_, i) => Number(parts[i]) || 0), order = compare(CURRENT, version);
  if (wildcard || operator === "=" && parts.length < 3) return parts.every((part, i) => /^[xX*]$/.test(part) || Number(part) === CURRENT[i]);
  return compareRange(operator, { parts, version, order });
}
function compareRange(operator, { parts, version, order }) {
  if (operator === "^") {
    const index = version.findIndex((part) => part !== 0), slot = index < 0 ? 2 : index;
    const upper = version.map((part, i) => i < slot ? part : i === slot ? part + 1 : 0);
    return order >= 0 && compare(CURRENT, upper) < 0;
  }
  if (operator === "~") {
    const upper = parts.length === 1 ? [version[0] + 1, 0, 0] : [version[0], version[1] + 1, 0];
    return order >= 0 && compare(CURRENT, upper) < 0;
  }
  return { "=": order === 0, ">": order > 0, ">=": order >= 0, "<": order < 0, "<=": order <= 0 }[operator];
}
export function validateEngine(engines) {
  if (engines === undefined) return;
  validateEngineFields(engines);
  const range = engines.piDesktop;
  if (range === undefined) return;
  if (!matchesVersionRange(range)) throw new Error(`插件需要 PI API ${range}，当前兼容版本为 ${PI_API_VERSION}`);
}
function validateEngineFields(engines) {
  if (!engines || typeof engines !== "object" || Array.isArray(engines) || Object.keys(engines).some((key) => key !== "piDesktop")) throw new Error("engines 字段无效");
}
