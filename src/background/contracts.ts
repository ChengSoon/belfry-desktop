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
  /**
   * 背景图可见度 0..1。遮罩的 alpha 取 1 - opacity，
   * 所以这个值越小，画布底色压得越狠、终端文字越清楚。
   */
  opacity: number;
  /** 模糊半径，px。 */
  blur: number;
}

export const MAX_BLUR = 40;

/**
 * 默认偏保守：0.35 的可见度足以看出是哪张图，又不至于让正文难读。
 * 用户拉高是主动选择，默认值不该替他冒险。
 */
export const DEFAULT_BACKGROUND: BackgroundConfig = {
  fileName: null,
  mime: null,
  fit: "cover",
  opacity: 0.35,
  blur: 0,
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
