import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import appIconUrl from "../../src-tauri/icons/32x32.png";

const appWindow = getCurrentWindow();

export function WindowTitlebar() {
  const toggleMaximize = () => void appWindow.toggleMaximize();

  return (
    <>
      {/* macOS Overlay 模式仍由这条透明区域承接系统窗口拖拽。 */}
      <div className="titlebar-drag" data-tauri-drag-region />

      <header className="window-titlebar" onDoubleClick={toggleMaximize}>
        <div className="window-title" data-tauri-drag-region>
          <img alt="" aria-hidden="true" src={appIconUrl} />
          <span data-tauri-drag-region>Belfry</span>
        </div>
        <div className="window-titlebar-spacer" data-tauri-drag-region />
        <div className="window-controls" onDoubleClick={(event) => event.stopPropagation()}>
          <button
            aria-label="最小化"
            onClick={() => void appWindow.minimize()}
            title="最小化"
            type="button"
          >
            <Minus aria-hidden="true" size={17} strokeWidth={1.5} />
          </button>
          <button aria-label="最大化" onClick={toggleMaximize} title="最大化" type="button">
            <Square aria-hidden="true" size={13} strokeWidth={1.5} />
          </button>
          <button
            aria-label="关闭"
            className="window-control-close"
            onClick={() => void appWindow.close()}
            title="关闭"
            type="button"
          >
            <X aria-hidden="true" size={18} strokeWidth={1.5} />
          </button>
        </div>
      </header>
    </>
  );
}
