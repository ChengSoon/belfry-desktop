import type { ThemeMode } from "../theme/contracts";

export type BackgroundFit = "cover" | "contain" | "tile" | "center";

export const BACKGROUND_FITS: BackgroundFit[] = ["cover", "contain", "tile", "center"];

/** 后端导入成功后回报的落盘结果。 */
export interface BackgroundAsset {
  fileName: string;
  mime: string;
  byteSize: number;
}

export interface BackgroundConfig {
  /** 应用数据目录下的文件名；null = 没有设置背景图。 */
  fileName: string | null;
  mime: string | null;
  fit: BackgroundFit;
  /** 背景图自身可见度 0..1，控制图片向画布色淡出的程度。 */
  opacity: number;
  /** 模糊半径，px。 */
  blur: number;
  /**
   * 终端区文字衬底浓度 0..1：在图上垫一层画布色，保住正文对比度。
   * 只作用于终端内容区——侧栏和面板有各自的固定底色（见 background.css），
   * 不跟这个值走；0 = 终端文字直接压在图上。
   *
   * 亮暗各记一份，因为两边需要的浓度差得远：浅底上深字本来就靠灰度抗锯齿显细，
   * 底下再透出图案的高频细节，人眼判边缘时被噪声干扰；暗色靠光渗反而显实。
   * 挑哪一份交给 CSS 按 data-theme 决定（见 background.css），JS 侧把两份都写出去——
   * 这样 BackgroundProvider 不必去读主题，两个 Provider 保持互不依赖。
   */
  veil: Record<ThemeMode, number>;
  /** 动态壁纸是否暂停；对静态图片没有影响。 */
  videoPaused: boolean;
}

export const MAX_BLUR = 40;

/** 默认图完整显示、终端垫衬底：图的氛围和正文可读性各让一步。 */
export const DEFAULT_BACKGROUND: BackgroundConfig = {
  fileName: null,
  mime: null,
  fit: "cover",
  opacity: 1,
  blur: 0,
  // 暗色 55% 观感是好的，不动；亮色提到 80%，让文字底下接近纯色。
  veil: { dark: 0.55, light: 0.8 },
  videoPaused: false,
};

export interface BackgroundController {
  config: BackgroundConfig;
  /** 壁纸字节就绪后的 Blob URL；没设壁纸、或还在加载时为 null。 */
  url: string | null;
  busy: boolean;
  error: string | null;
  /** 改参数。落盘是同步做的，见 BackgroundProvider 里的说明。 */
  update: (patch: Partial<BackgroundConfig>) => void;
  /** 弹文件对话框选一张图并导入。 */
  pick: () => Promise<void>;
  /** 移除当前背景图。 */
  clear: () => Promise<void>;
}
