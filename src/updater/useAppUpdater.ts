import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { INITIAL_UPDATER_STATE, type UpdaterState } from "./contracts";
import { applyDownloadEvent, EMPTY_DOWNLOAD_PROGRESS } from "./progress";

const STARTUP_CHECK_DELAY_MS = 1500;
const UPDATE_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
/** 后台巡检间隔：窗口常开不重启时，光靠启动那一次检查永远收不到新版本。 */
const PERIODIC_CHECK_MS = 6 * 60 * 60_000;
/**
 * 首次检查失败后的退避节奏。刚发版那几十秒 GitHub 的 latest 指针和资产 CDN
 * 还没就绪，恰好在此时启动就会扑空；不重试的话这一次失败会一直沉默下去。
 */
const RETRY_BACKOFF_MS = [15_000, 60_000, 5 * 60_000];

export function useAppUpdater() {
  const [state, setState] = useState<UpdaterState>(INITIAL_UPDATER_STATE);
  const [open, setOpen] = useState(false);
  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);
  // 巡检要读当前状态又不该因状态变化重建定时器链，所以走 ref。
  const statusRef = useRef<UpdaterState["status"]>(INITIAL_UPDATER_STATE.status);

  const checkNow = useCallback(async (showResult = true) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setState((value) => ({ ...value, status: "checking", error: null }));
    try {
      await releaseUpdate(updateRef);
      const update = await check({ timeout: UPDATE_TIMEOUT_MS });
      if (update) {
        updateRef.current = update;
        setState(updateState(update));
        if (showResult) setOpen(true);
      } else {
        setState((value) => currentState(value.currentVersion));
        if (showResult) setOpen(true);
      }
      return true;
    } catch (error) {
      setState((value) => errorState(value, error));
      if (showResult) setOpen(true);
      return false;
    } finally {
      busyRef.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update || busyRef.current) return;
    busyRef.current = true;
    setState((value) => ({ ...value, status: "downloading", error: null }));
    let progress = EMPTY_DOWNLOAD_PROGRESS;
    try {
      await update.downloadAndInstall((event) => {
        progress = applyDownloadEvent(progress, event);
        setState((value) => downloadState(value, event, progress));
      }, { timeout: DOWNLOAD_TIMEOUT_MS });
      setState((value) => ({ ...value, status: "installing", progress: 100 }));
      await relaunch();
    } catch (error) {
      setState((value) => errorState(value, error));
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  useEffect(() => {
    void getVersion()
      .then((version) => setState((value) => ({ ...value, currentVersion: version })))
      .catch(() => undefined);

    let timer = 0;
    let attempt = 0;
    let disposed = false;

    const schedule = (delay: number) => {
      timer = window.setTimeout(() => void run(), delay);
    };

    const run = async () => {
      if (disposed) return;
      // 正在下载安装、或用户已经收到可用更新的提示，这一轮都不必再拉。
      if (busyRef.current || statusRef.current === "available") {
        schedule(PERIODIC_CHECK_MS);
        return;
      }
      const ok = await checkNow(false);
      if (disposed) return;
      if (ok) {
        attempt = 0;
        schedule(PERIODIC_CHECK_MS);
        return;
      }
      // 退避重试几轮再回到长间隔，避免一次网络抖动就静默到下次重启。
      const backoff = RETRY_BACKOFF_MS[attempt];
      attempt += 1;
      schedule(backoff ?? PERIODIC_CHECK_MS);
    };

    schedule(STARTUP_CHECK_DELAY_MS);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      void releaseUpdate(updateRef);
    };
  }, [checkNow]);

  const openPanel = useCallback(() => {
    setOpen(true);
    if (["idle", "current", "error"].includes(state.status)) void checkNow(true);
  }, [checkNow, state.status]);

  return {
    state,
    open,
    openPanel,
    closePanel: () => setOpen(false),
    checkNow: () => void checkNow(true),
    install: () => void install(),
  };
}

async function releaseUpdate(ref: { current: Update | null }) {
  const update = ref.current;
  ref.current = null;
  if (update) await update.close();
}

function updateState(update: Update): UpdaterState {
  return {
    ...INITIAL_UPDATER_STATE,
    status: "available",
    currentVersion: update.currentVersion,
    availableVersion: update.version,
    notes: update.body?.trim() || null,
  };
}

function currentState(currentVersion: string): UpdaterState {
  return { ...INITIAL_UPDATER_STATE, status: "current", currentVersion };
}

function downloadState(
  state: UpdaterState,
  event: DownloadEvent,
  progress: typeof EMPTY_DOWNLOAD_PROGRESS,
): UpdaterState {
  return {
    ...state,
    status: event.event === "Finished" ? "installing" : "downloading",
    ...progress,
  };
}

function errorState(state: UpdaterState, error: unknown): UpdaterState {
  const detail = error instanceof Error ? error.message : String(error);
  return { ...state, status: "error", error: friendlyError(detail) };
}

function friendlyError(detail: string) {
  if (/404|not found/i.test(detail)) return "发布源暂时没有可用的更新描述，请稍后再试。";
  if (/network|fetch|connect|dns|timed? out/i.test(detail)) return "无法连接更新服务器，请检查网络后重试。";
  return detail || "检查更新失败，请稍后重试。";
}
