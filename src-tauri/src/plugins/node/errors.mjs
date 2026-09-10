export function apiError(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}
export function errorValue(error) {
  return { code: error?.code || "PLUGIN_ERROR", message: String(error?.message ?? error) };
}
export function permission(entry, name) {
  const legacy = name.startsWith("fs.") ? `${name}.workspace` : "";
  if (!entry.manifest.permissions?.some((value) => value === name || value === legacy)) {
    throw apiError("PERMISSION_DENIED", `插件未获 ${name} 权限`);
  }
}
