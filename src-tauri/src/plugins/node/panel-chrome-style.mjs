// Adapted from PI-Desktop plugin-panel.ts, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
export const CHROME_STYLE = `
    :host {
      color-scheme: light dark;
      pointer-events: none;
      position: fixed;
      inset: 0 0 auto 0;
      z-index: 2147483647;
      display: block;
      height: 46px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }
    .chrome {
      position: relative;
      width: 100%;
      height: 46px;
    }
    .drag-region {
      -webkit-app-region: drag;
      app-region: drag;
      pointer-events: auto;
      position: absolute;
      inset: 0;
      z-index: 0;
      height: 46px;
      user-select: none;
    }
    /* Paint-through pages replace the full drag rectangle with empty-space
       segments. The gaps expose page controls instead of relying on
       pointer-events alone, which does not override Electron's native
       -webkit-app-region hit testing. */
    :host([data-chrome-mode="paint-through"]) .drag-region {
      -webkit-app-region: no-drag;
      app-region: no-drag;
      pointer-events: none;
    }
    .drag-segment {
      -webkit-app-region: drag;
      app-region: drag;
      pointer-events: auto;
      position: absolute;
      z-index: 0;
      user-select: none;
    }
    .safe-area-hint {
      position: absolute;
      top: 50%;
      left: 10px;
      z-index: 1;
      max-width: calc(100% - 126px);
      overflow: hidden;
      color: color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 46%, transparent);
      font-size: 10px;
      line-height: 1;
      pointer-events: none;
      text-overflow: ellipsis;
      transform: translateY(-50%);
      user-select: none;
      white-space: nowrap;
    }
    .capsule {
      -webkit-app-region: no-drag;
      app-region: no-drag;
      pointer-events: auto;
      position: absolute;
      top: 9px;
      right: 8px;
      z-index: 2;
      box-sizing: border-box;
      display: flex;
      width: 96px;
      height: 28px;
      align-items: center;
      gap: 1px;
      overflow: hidden;
      border: 1px solid color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 16%, transparent);
      border-radius: 999px;
      padding: 1px;
      background: color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 6%, transparent);
      user-select: none;
    }
    .control {
      -webkit-app-region: no-drag;
      app-region: no-drag;
      pointer-events: auto;
      display: inline-flex;
      min-width: 0;
      height: 24px;
      flex: 1 1 0;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 7px;
      outline: none;
      background: transparent;
      color: color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 58%, transparent);
      cursor: pointer;
      font: inherit;
      transition: background 150ms cubic-bezier(0.22, 1, 0.36, 1), color 150ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .control:hover {
      background: color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 8%, transparent);
      color: var(--pi-plugin-panel-page-foreground);
    }
    .control:focus-visible {
      box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--pi-plugin-panel-page-foreground) 50%, transparent);
    }
    .control-close:hover {
      background: rgba(210, 43, 51, 0.78);
      color: #ffffff;
    }
    .glyph {
      position: relative;
      display: block;
      box-sizing: border-box;
      width: 12px;
      height: 12px;
    }
    .glyph-minimize::before {
      position: absolute;
      top: 6px;
      left: 1px;
      width: 10px;
      border-top: 1px solid currentColor;
      content: "";
    }
    .glyph-maximize {
      width: 10px;
      height: 10px;
      border: 1px solid currentColor;
    }
    .glyph-restore::before,
    .glyph-restore::after {
      position: absolute;
      box-sizing: border-box;
      width: 8px;
      height: 8px;
      border: 1px solid currentColor;
      content: "";
    }
    .glyph-restore::before {
      top: 1px;
      right: 1px;
    }
    .glyph-restore::after {
      bottom: 1px;
      left: 1px;
      background: var(--pi-plugin-panel-page-background);
    }
    .glyph-close::before,
    .glyph-close::after {
      position: absolute;
      top: 5.5px;
      left: 0.5px;
      width: 11px;
      border-top: 1px solid currentColor;
      content: "";
      transform: rotate(45deg);
    }
    .glyph-close::after {
      transform: rotate(-45deg);
    }
    :host([data-theme="light"]) {
      color-scheme: light;
    }
    :host([data-theme="dark"]) {
      color-scheme: dark;
    }
    @media (prefers-reduced-motion: reduce) {
      .control {
        transition-duration: 0.01ms;
      }
    }
  `;
