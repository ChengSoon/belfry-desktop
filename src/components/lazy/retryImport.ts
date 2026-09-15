import type { PanelModule } from "./panelImport";

interface RetryOptions { exportName?: string; attempt: number; baseUrl: string; resource?: "module" | "style" }

export function isModuleLoadFailure(error: unknown) {
  return error instanceof Error
    && /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(error.message);
}

/** Chromium 会记住失败的模块 URL；只对本应用的面板入口添加一次重试标记。 */
export function panelRetryUrl(error: unknown, options: RetryOptions) {
  if (!(error instanceof Error)) return null;
  const pattern = options.resource === "style" ? /Unable to preload CSS for\s+(\S+)/i
    : /(?:Failed to fetch dynamically imported module|error loading dynamically imported module):\s*(\S+)/i;
  const failed = error.message.match(pattern)?.[1];
  if (!failed) return null;
  try {
    const base = new URL(options.baseUrl), url = new URL(failed, base);
    if (url.origin !== base.origin || url.protocol !== base.protocol || url.host !== base.host) return null;
    const file = url.pathname.split("/").at(-1)!;
    if (!(options.resource === "style" ? /\.css$/ : /\.(?:[cm]?js|tsx?)$/).test(file)) return null;
    if (options.resource !== "style" && options.exportName
      && !file.startsWith(`${options.exportName}.`) && !file.startsWith(`${options.exportName}-`)) return null;
    url.searchParams.set("belfryPanelRetry", String(options.attempt));
    return url.href;
  } catch { return null; }
}

export function retryPanelImport<Props>(error: unknown, options: Omit<RetryOptions, "baseUrl">) {
  if (typeof location === "undefined") return null;
  const url = panelRetryUrl(error, { ...options, baseUrl: location.href });
  if (!url) return null;
  return import(/* @vite-ignore */ url).then((module): PanelModule<Props> => {
    const component = module[options.exportName ?? "default"];
    if (!component) throw new Error("面板模块没有提供预期的入口");
    return { default: component };
  });
}

export function retryPanelStyles(error: unknown, options: Omit<RetryOptions, "baseUrl">) {
  if (typeof location === "undefined") return null;
  const url = panelRetryUrl(error, { ...options, baseUrl: location.href, resource: "style" });
  if (!url) return null;
  return new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.onload = () => { link.onload = link.onerror = null; resolve(); };
    link.onerror = () => {
      link.remove();
      reject(new Error(`Unable to preload CSS for ${url}`));
    };
    document.head.append(link);
  });
}
