// D1 私有纯逻辑原型；不定义 manifest、IPC 或持久化协议。
const VERSION_PART_MAX = 65535;
const VERSION_TEXT_MAX = 17;
const VERSION_PATTERN = /^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$/u;
type Version = readonly [number, number, number];

export function parsePluginVersion(value: string): Version | null {
  if (value.length > VERSION_TEXT_MAX) return null;
  const match = VERSION_PATTERN.exec(value);
  // JS 的 $ 也能匹配末尾换行之前；版本必须完全匹配。
  if (!match || match[0] !== value) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > VERSION_PART_MAX)) return null;
  return [parts[0], parts[1], parts[2]];
}

export function comparePluginVersions(left: string, right: string) {
  const a = parsePluginVersion(left);
  const b = parsePluginVersion(right);
  return a && b ? compareTriples(a, b) : null;
}

function compareTriples(left: Version, right: Version): -1 | 0 | 1 {
  for (const [index, part] of left.entries()) {
    if (part < right[index]) return -1;
    if (part > right[index]) return 1;
  }
  return 0;
}

// 参数是算法输入，不是 compatibility 的 wire format。上游另行检查 schema/API。
export function checkVersionRange(input: { host: string; min: string; maxExclusive?: string }) {
  const min = parsePluginVersion(input.min);
  const max = input.maxExclusive === undefined ? null : parsePluginVersion(input.maxExclusive);
  if (!min || invalidMaximum(input.maxExclusive, max)) return "invalid-range";
  if (max && compareTriples(min, max) >= 0) return "invalid-range";
  const host = parseHostVersion(input.host);
  if (!host) return "invalid-host";
  if (compareTriples(host, min) < 0) return "too-old";
  if (max && compareTriples(host, max) >= 0) return "too-new";
  return "compatible";
}
function invalidMaximum(input: string | undefined, parsed: Version | null) { return input !== undefined && !parsed; }

function parseHostVersion(value: string): Version | null {
  const match = /^([0-9]+\.[0-9]+\.[0-9]+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(value);
  if (!match || match[0] !== value) return null;
  const identifiers = match[2]?.split(".") ?? [];
  if (identifiers.some((part) => /^[0-9]+$/u.test(part) && part.length > 1 && part.startsWith("0"))) {
    return null;
  }
  return parsePluginVersion(match[1]);
}
