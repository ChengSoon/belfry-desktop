import type { TerminalTheme } from "../theme/xtermTheme";
import type { TypographyRuntime } from "../typography/contracts";
import type { TerminalLaunch } from "./contracts";
import { TerminalLayout } from "./controller/layout";
import { TerminalLifecycle } from "./controller/lifecycle";
import { TerminalView } from "./controller/view";
import type { MountCallbacks, TerminalHandle } from "./controller/types";

export type { MountCallbacks, TerminalHandle } from "./controller/types";
export { diagnoseTerminalExit, errorMessage } from "./controller/diagnostics";

/** 保持宿主调用面稳定，各模块独立管理输入、解析、连接和显示资源。 */
export function mountTerminal(
  host: HTMLDivElement,
  launch: TerminalLaunch,
  theme: TerminalTheme,
  transparent: boolean,
  typography: TypographyRuntime,
  callbacks: MountCallbacks,
): TerminalHandle {
  const view = new TerminalView({ host, theme, transparent, typography,
    codex: launch.profileId === "agent:codex", onOpenFile: callbacks.onOpenFile });
  const lifecycle = new TerminalLifecycle({ host, launch, theme, callbacks,
    terminal: view.terminal, fit: view.fit, themeSync: view.themeSync,
    onStopped: () => layout.cancelPending(), onReady: () => layout.syncSize() });
  const layout = new TerminalLayout({ host, terminal: view.terminal, fit: view.fit,
    session: () => lifecycle.current, update: (session) => lifecycle.updateSession(session), error: callbacks.onError });
  void lifecycle.start();
  return createHandle({ view, lifecycle, layout });
}

function createHandle({ view, lifecycle, layout }: {
  view: TerminalView; lifecycle: TerminalLifecycle; layout: TerminalLayout;
}): TerminalHandle {
  return {
    applyTheme: (theme, transparent) => {
      if (!lifecycle.alive) return;
      view.applyTheme(theme, transparent);
      layout.refreshTypography();
      lifecycle.updatePalette(theme);
    },
    applyTypography: (typography) => {
      if (!lifecycle.alive) return;
      view.applyTypography(typography);
      layout.refreshTypography();
    },
    search: view.search,
    focus: () => { if (lifecycle.alive) view.terminal.focus(); },
    sendText: (text) => lifecycle.sendText(text),
    dispose: () => {
      if (!lifecycle.alive) return;
      lifecycle.dispose();
      layout.dispose();
      view.dispose();
    },
  };
}
