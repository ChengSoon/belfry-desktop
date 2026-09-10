import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { DirectoryEntry, DirectoryRegistry, InstallPreview, PluginOperation } from "./hostContracts";
import type { ScaffoldInput } from "./runtimeContracts";
import { pluginError } from "./hostClient";
import { pluginHost } from "./useDirectoryRegistry";
import { refreshPluginRuntime } from "./usePluginRuntime";

function usePluginTask(refresh: () => Promise<void>, guard?: (value: boolean) => void) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const locked = useRef(false);
  useEffect(() => { guard?.(busy); return () => guard?.(false); }, [busy, guard]);
  async function run(operation: () => Promise<void>) {
    if (locked.current) return false;
    locked.current = true; setBusy(true); setNotice("");
    let success = false;
    try { await operation(); success = true; } catch (reason) { setNotice(pluginError(reason)); }
    finally { await refresh(); await refreshPluginRuntime(); locked.current = false; setBusy(false); }
    return success;
  }
  return { busy, notice, setNotice, run };
}
export function usePluginCenter(input: { registry: DirectoryRegistry | null; refresh: () => Promise<void>; guard?: (value: boolean) => void }) {
  const task = usePluginTask(input.refresh, input.guard);
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const pending = useRef(preview); pending.current = preview;
  useEffect(() => () => { if (pending.current) void pluginHost.cancel(pending.current.previewId).catch(() => {}); }, []);
  async function previewDirectory(path: string, development: boolean) {
    if (preview) await pluginHost.cancel(preview.previewId);
    setPreview(null); setPreview(await pluginHost.inspect(path, development));
  }
  function inspect(source: "package" | "directory" | "development") {
    return task.run(async () => {
      const path = await open({ directory: source !== "package", multiple: false, title: source === "package" ? "选择插件包" : "选择插件目录",
        filters: source === "package" ? [{ name: "插件包", extensions: ["piplug", "zip"] }] : undefined });
      if (typeof path === "string") await previewDirectory(path, source === "development");
    });
  }
  function install() {
    return task.run(async () => {
      if (!preview || !input.registry) return;
      await pluginHost.install(preview.previewId, input.registry.revision);
      setPreview(null); task.setNotice("安装成功。点击启用即可运行插件。");
    });
  }
  function mutate(entry: DirectoryEntry, action: PluginOperation) {
    return task.run(async () => {
      if (!input.registry) return;
      const result = await pluginHost.mutate(entry.manifest.id, action, input.registry.revision);
      task.setNotice(result.plugins.find((item) => item.manifest.id === entry.manifest.id)?.error ?? "插件状态已更新");
    });
  }
  function create(options: ScaffoldInput) {
    return task.run(async () => { const result = await pluginHost.scaffold(options); await previewDirectory(result.directory, true); });
  }
  function author(entry: DirectoryEntry, operation: "check" | "pack") {
    return task.run(() => authorAction(entry, operation, task.setNotice));
  }
  function cancel() { return task.run(async () => { if (preview) await pluginHost.cancel(preview.previewId); setPreview(null); }); }
  return { ...task, preview, inspect, install, mutate, create, author, cancel };
}
async function authorAction(entry: DirectoryEntry, operation: "check" | "pack", notice: (message: string) => void) {
  if (operation === "check") {
    const result = await pluginHost.check(entry.sourcePath);
    notice(`校验通过：${result.fileCount} 个文件，${Math.ceil(result.totalBytes / 1024)} KB。${result.warnings.join("；")}`);
    return;
  }
  const out = await open({ directory: true, multiple: false, title: "选择插件包保存目录" });
  if (typeof out !== "string") return;
  const result = await pluginHost.pack(entry.sourcePath, out);
  notice(`已生成插件包：${result.packagePath}`);
}
