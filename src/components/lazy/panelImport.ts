import type { ComponentType } from "react";
import { isModuleLoadFailure, retryPanelImport, retryPanelStyles } from "./retryImport";
import { PanelRecoveryRequired } from "./panelFailure";

export type PanelModule<Props> = { default: ComponentType<Props> };

/** 并发打开共用一次导入；可恢复失败允许重试，失效的 ESM 图在当前文档中保持失败状态。 */
export function createPanelImport<Props>(load: () => Promise<PanelModule<Props>>, exportName?: string) {
  let pending: Promise<PanelModule<Props>> | null = null;
  let failure: unknown;
  let attempt = 0;
  return () => {
    if (failure instanceof PanelRecoveryRequired) return Promise.reject(failure);
    pending ??= Promise.resolve().then(async () => {
      const options = { exportName, attempt: ++attempt };
      const styles = retryPanelStyles(failure, options);
      // Vite 会记住失败的 CSS 预加载；先补齐样式，才能再次打开面板。
      if (styles) { await styles; return load(); }
      const retry = retryPanelImport<Props>(failure, options);
      if (!retry) {
        if (isModuleLoadFailure(failure)) throw new PanelRecoveryRequired(failure);
        return load();
      }
      // Chromium 报的是入口 URL，即使真正失败的是静态依赖。
      // 新入口仍失败就停止，关闭/重开面板也不能重置浏览器的模块缓存。
      return retry.catch((error: unknown) => { throw new PanelRecoveryRequired(error); });
    }).catch((error: unknown) => {
      failure = error;
      pending = null;
      throw error;
    });
    return pending;
  };
}
