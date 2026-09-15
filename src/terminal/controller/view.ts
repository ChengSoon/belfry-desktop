import { FitAddon } from "@xterm/addon-fit";
import type { TerminalTheme } from "../../theme/xtermTheme";
import { minimumContrastRatio, withTransparentBackground } from "../../theme/xtermTheme";
import type { TypographyRuntime } from "../../typography/contracts";
import { CodexThemeSync } from "../codexThemeSync";
import { terminalFontWeights } from "../fontRendering";
import { registerFileLinkProvider, registerHttpLinkProvider } from "../links";
import { TerminalSearchController } from "../search";
import { configureUnicode } from "../unicode";
import { attachWebglRenderer, applyTypographyOptions, createXterm } from "./renderConfig";

interface ViewOptions {
  host: HTMLDivElement;
  theme: TerminalTheme;
  transparent: boolean;
  typography: TypographyRuntime;
  codex: boolean;
  onOpenFile: (path: string, line: number | null) => void;
}

export class TerminalView {
  readonly terminal;
  readonly themeSync;
  readonly search;
  readonly fit = new FitAddon();
  private readonly links;
  private readonly fileLinks;
  private readonly renderer;

  constructor(options: ViewOptions) {
    this.terminal = createXterm(options.theme, options.transparent, options.typography);
    configureUnicode(this.terminal);
    this.links = registerHttpLinkProvider(this.terminal);
    this.fileLinks = registerFileLinkProvider(this.terminal, options.onOpenFile);
    this.search = new TerminalSearchController(this.terminal);
    this.themeSync = new CodexThemeSync(options.theme, options.transparent, options.codex);
    this.terminal.loadAddon(this.fit);
    this.terminal.open(options.host);
    this.renderer = attachWebglRenderer(this.terminal);
    this.fit.fit();
  }

  applyTheme(theme: TerminalTheme, transparent: boolean) {
    this.themeSync.setTheme(theme, transparent);
    this.terminal.options.allowTransparency = transparent;
    this.terminal.options.theme = transparent ? withTransparentBackground(theme) : theme;
    this.terminal.options.minimumContrastRatio = minimumContrastRatio(theme);
    Object.assign(this.terminal.options, terminalFontWeights(theme));
  }

  applyTypography(typography: TypographyRuntime) {
    applyTypographyOptions(this.terminal, typography);
  }

  dispose() {
    this.renderer?.dispose();
    this.links.dispose();
    this.fileLinks.dispose();
    this.terminal.dispose();
  }
}
