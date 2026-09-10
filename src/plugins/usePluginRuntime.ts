import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { pluginHost } from "./useDirectoryRegistry";
import { pluginError } from "./hostClient";
import { emptyRuntimeCatalog } from "./runtimeContracts";

let catalog = emptyRuntimeCatalog;
let epoch = 0;
let listenerGeneration = 0;
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let scheduled: ReturnType<typeof setTimeout> | undefined;
let stopListening: (() => void) | undefined;
export async function refreshPluginRuntime() {
  const request = ++epoch;
  try { const value = await pluginHost.runtime(); if (request === epoch) catalog = value; }
  catch (reason) { if (request === epoch) catalog = { ...emptyRuntimeCatalog, error: pluginError(reason) }; }
  if (request === epoch) subscribers.forEach((notify) => notify());
}
function subscribe(notify: () => void) {
  subscribers.add(notify);
  if (subscribers.size === 1) {
    const generation = ++listenerGeneration;
    void refreshPluginRuntime();
    timer = setInterval(() => void refreshPluginRuntime(), 3000);
    void listen<{ name: string }>("plugin-runtime-event", ({ payload }) => {
      if (generation !== listenerGeneration || ["log", "hostLog"].includes(payload.name) || scheduled) return;
      scheduled = setTimeout(() => { scheduled = undefined; void refreshPluginRuntime(); }, 150);
    }).then((stop) => { if (generation === listenerGeneration && subscribers.size) stopListening = stop; else stop(); }).catch(() => {});
  }
  return () => {
    subscribers.delete(notify);
    if (!subscribers.size) { ++epoch; ++listenerGeneration; clearInterval(timer); clearTimeout(scheduled); scheduled = undefined; stopListening?.(); stopListening = undefined; }
  };
}
export function usePluginRuntime() {
  return useSyncExternalStore(subscribe, () => catalog, () => emptyRuntimeCatalog);
}
