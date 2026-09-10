import { useEffect, type RefObject } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { RuntimeView } from "../runtimeContracts";
import { pluginHost } from "../useDirectoryRegistry";
import { pluginNotice } from "../notices";

export function useViewDrops(container: RefObject<HTMLElement | null>, active: RuntimeView | undefined) {
  useEffect(() => {
    if (!active) return;
    let live = true;
    const stop = getCurrentWebview().onDragDropEvent(async ({ payload }) => {
      if (!live || payload.type !== "drop") return;
      const frame = container.current?.querySelector<HTMLIFrameElement>("iframe:not([hidden])");
      if (!frame || frame.closest("[hidden]")) return;
      const scale = await getCurrentWindow().scaleFactor();
      if (!live) return;
      const bounds = frame.getBoundingClientRect();
      const x = payload.position.x / scale - bounds.left, y = payload.position.y / scale - bounds.top;
      if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) return;
      void pluginHost.requestRuntime("surface.drop", { pluginId: active.pluginId, surfaceId: `view:${active.id}`,
        paths: payload.paths, position: { x, y } }).catch((error) => pluginNotice(String(error)));
    }).catch(() => () => {});
    return () => { live = false; void stop.then((unlisten) => unlisten()); };
  }, [active?.pluginId, active?.id, container]);
}
