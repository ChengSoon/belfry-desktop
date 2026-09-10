import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { pluginHost } from "../useDirectoryRegistry";
import { pluginNotice } from "../PluginRuntimeBridge";
import { pluginError } from "../hostClient";
import type { InstallPreview, PluginOperation } from "../hostContracts";
import type { ActivationScope, PluginSummary } from "./types";
import { centerApi } from "./api";
import { orderPermissions, type TemplateId } from "./helpers";
import { t } from "./i18n";

export interface InstallProposal {
  id: string; name: string; version?: string; permissions: string[]; newPermissions: string[];
  preview?: InstallPreview; market?: boolean;
}
export function useCenterActions(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<InstallProposal | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const run = async (operation: () => Promise<unknown>) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError("");
    try { await operation(); await refresh(); return true; }
    catch (reason) { setError(pluginError(reason)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const mutate = async (id: string, action: PluginOperation) => {
    const registry = await pluginHost.list();
    return pluginHost.mutate(id, action, registry.revision);
  };
  const setScope = (plugin: PluginSummary, scope: ActivationScope) => run(async () => {
    await centerApi.setPreference(plugin.id, { scope });
    if (!plugin.enabled) await mutate(plugin.id, "enable");
  });
  const queueInstall = (input: Omit<InstallProposal, "newPermissions"> & { newPermissions?: string[] }) => {
    const show = (preview?: InstallPreview) => {
      const permissions = preview?.manifest.runtime?.permissions ?? input.permissions;
      setPending({ ...input, preview: preview ?? input.preview, market: !input.preview, permissions: orderPermissions(permissions),
        newPermissions: orderPermissions([...(input.newPermissions ?? []), ...permissions.filter((permission) => !input.permissions.includes(permission))]) });
      setAutoUpdate(true);
    };
    if (input.preview) show();
    else void run(async () => { const result = await centerApi.marketInspect(input.id, input.version); show(result.preview); });
  };
  return { busy, error, run, mutate, setScope, pending, setPending, autoUpdate, setAutoUpdate, queueInstall };
}
export type CenterActions = ReturnType<typeof useCenterActions>;

export async function inspectLocal(actions: CenterActions, development: boolean) {
  await actions.run(async () => {
    const path = await open({ directory: development, multiple: false, title: t(development ? "plugins.loadDev" : "plugins.installPackage"),
      ...(development ? {} : { filters: [{ name: "PI 插件包", extensions: ["piplug", "zip"] }] }) });
    if (typeof path !== "string") return;
    const preview = await pluginHost.inspect(path, development);
    const manifest = preview.manifest;
    actions.queueInstall({ id: manifest.id, name: manifest.name, version: manifest.version,
      permissions: manifest.runtime?.permissions ?? manifest.permissions, preview });
  });
}
export async function confirmInstall(actions: CenterActions) {
  const pending = actions.pending;
  if (!pending) return;
  await actions.run(async () => {
    if (pending.market && pending.preview) {
      await centerApi.marketInstall({ id: pending.id, version: pending.version, previewId: pending.preview.previewId, enable: true,
        autoUpdate: actions.autoUpdate, grantedPermissions: pending.permissions });
    } else if (pending.preview) {
      const registry = await pluginHost.list();
      const installed = await pluginHost.install(pending.preview.previewId, registry.revision);
      await pluginHost.mutate(pending.id, "enable", installed.revision);
    } else throw new Error("请重新预览插件");
    actions.setPending(null);
    pluginNotice(t("plugins.installed", { name: pending.name }));
  });
}
export async function cancelInstall(actions: CenterActions) {
  if (actions.busy) return;
  if (actions.pending?.preview) await pluginHost.cancel(actions.pending.preview.previewId).catch(() => {});
  actions.setPending(null);
}
export async function createFromTemplate(actions: CenterActions, template: TemplateId, metadata?: { name?: string; id?: string; author?: string }) {
  return actions.run(async () => {
    const result = await centerApi.create(template, metadata);
    if (result.canceled || !result.directory) return;
    window.dispatchEvent(new CustomEvent("plugin-open-project", { detail: result.directory }));
    pluginNotice(t("plugins.newFromTemplateOpened", { name: result.name ?? "" }));
  });
}
