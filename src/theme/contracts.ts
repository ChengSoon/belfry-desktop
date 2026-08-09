export type ThemeMode = "dark" | "light";

export interface ThemeController {
  mode: ThemeMode;
  /** 用户是否显式选过主题；false 表示仍跟随系统。 */
  pinned: boolean;
  select: (mode: ThemeMode) => void;
  toggle: () => void;
}
