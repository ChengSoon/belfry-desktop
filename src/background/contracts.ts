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
   */
  veil: number;
}

export const MAX_BLUR = 40;

/** 默认图完整显示、终端垫半衬底：图的氛围和正文可读性各让一步。 */
export const DEFAULT_BACKGROUND: BackgroundConfig = {
  fileName: null,
  mime: null,
  fit: "cover",
  opacity: 1,
  blur: 0,
  veil: 0.55,
};

export interface BackgroundController {
  config: BackgroundConfig;
  /** 图片字节就绪后的 Blob URL；没设背景图、或还在加载时为 null。 */
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
