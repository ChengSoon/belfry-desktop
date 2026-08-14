import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { importBackground, readBackground, removeBackground } from "./api";
import {
  type BackgroundConfig,
  type BackgroundController,
  type BackgroundFit,
} from "./contracts";
import { loadBackground, saveBackground } from "./storage";

const BackgroundContext = createContext<BackgroundController | null>(null);

/** fit 模式落到 CSS 上就是这两个属性的组合。 */
const FIT_STYLE: Record<BackgroundFit, { size: string; repeat: string }> = {
  cover: { size: "cover", repeat: "no-repeat" },
  contain: { size: "contain", repeat: "no-repeat" },
  tile: { size: "auto", repeat: "repeat" },
  center: { size: "auto", repeat: "no-repeat" },
};

/**
 * 背景图的状态与资源管理。
 *
 * 单独开一个 Provider 而不是并进 ThemeProvider：主题是同步的二值枚举，
 * 背景是「一组连续参数 + 一份异步加载的二进制资源」，混在一起会把那边显著撑复杂。
 * 两者也不需要在 JS 层耦合——遮罩色读的是 var(--canvas)，切主题时 CSS 自己会跟上。
 */
export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState(loadBackground);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 落盘文件名是固定的（background.png 之类），换一张图 fileName 往往不变。
  // 靠这个计数把加载 effect 顶一次，否则界面会一直停在上一张。
  const [assetVersion, setAssetVersion] = useState(0);

  const urlRef = useRef<string | null>(null);

  /** 旧的 Blob URL 等新的就绪了再回收，中间不留空档，避免换图时闪一下。 */
  const swapUrl = useCallback((next: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = next;
    setUrl(next);
  }, []);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  useEffect(() => {
    if (!config.fileName) {
      swapUrl(null);
      return;
    }
    let cancelled = false;
    readBackground()
      .then((bytes) => {
        if (cancelled) return;
        swapUrl(URL.createObjectURL(new Blob([bytes], { type: config.mime ?? "image/png" })));
      })
      .catch(() => {
        // 文件被用户手动删掉了就当没设过背景，不必弹错打断他。
        if (!cancelled) swapUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [config.fileName, config.mime, assetVersion, swapUrl]);

  /* 配置广播走 CSS 变量而不是 props：背景层不用为了这几个参数被穿透一路传参，
     并且 data-background 同时驱动 terminal.css 里 xterm 底色、以及侧栏等面的半透明。 */
  useEffect(() => {
    const root = document.documentElement;
    const fit = FIT_STYLE[config.fit];
    root.dataset.background = url ? "on" : "off";
    root.style.setProperty("--app-bg-image", url ? `url("${url}")` : "none");
    root.style.setProperty("--app-bg-opacity", String(config.opacity));
    root.style.setProperty("--app-bg-blur", `${config.blur}px`);
    root.style.setProperty("--app-bg-size", fit.size);
    root.style.setProperty("--app-bg-repeat", fit.repeat);
  }, [url, config]);

  /* 每次变更直接落盘，不做防抖：这份 JSON 只有几十字节，同步写一次远快于一帧，
     滑块连续拖动也不会掉帧，换来的是任何时刻关掉应用配置都是最新的。 */
  useEffect(() => {
    saveBackground(config);
  }, [config]);

  const update = useCallback((patch: Partial<BackgroundConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const pick = useCallback(async () => {
    setError(null);
    let selected: string | string[] | null;
    try {
      selected = await openDialog({
        directory: false,
        multiple: false,
        title: "选择背景图",
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    if (typeof selected !== "string") return; // 用户取消了

    setBusy(true);
    try {
      const asset = await importBackground(selected);
      setConfig((prev) => ({ ...prev, fileName: asset.fileName, mime: asset.mime }));
      setAssetVersion((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await removeBackground();
      setConfig((prev) => ({ ...prev, fileName: null, mime: null }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const controller = useMemo<BackgroundController>(
    () => ({ config, url, busy, error, update, pick, clear }),
    [config, url, busy, error, update, pick, clear],
  );

  return <BackgroundContext value={controller}>{children}</BackgroundContext>;
}

export function useBackground() {
  const controller = useContext(BackgroundContext);
  if (!controller) throw new Error("useBackground 必须在 BackgroundProvider 内使用");
  return controller;
}

/** 后端的 AppError 过 IPC 后是个带 message 的普通对象，不是 Error 实例。 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
