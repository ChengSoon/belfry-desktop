import { useEffect, useState } from "react";
import { readGitBranch } from "./api";
import type { GitBranch } from "./contracts";

/**
 * 顶栏面包屑的分支名（code-review M3）。不定时轮询，只在这些时刻读：
 * - rootPath 变化（切项目 / 切到另一个项目的会话）；
 * - 窗口重新获焦或重新可见（在别处 checkout 后切回来就会更新）；
 * - 调用方改变 refreshKey（例如当前会话从「工作中」回到空闲，可能刚跑过 git checkout）。
 * 读取失败、非仓库都给 null——面包屑只是位置提示，不在这里报错。
 */
export function useGitBranch(rootPath: string | null, refreshKey?: unknown): GitBranch | null {
  const [state, setState] = useState<{ rootPath: string | null; value: GitBranch | null }>({ rootPath, value: null });
  useEffect(() => {
    if (!rootPath) { setState({ rootPath, value: null }); return; }
    return watchBranch(rootPath, (value) => setState({ rootPath, value }));
  }, [rootPath, refreshKey]);
  return state.rootPath === rootPath ? state.value : null;
}

/** 订阅一次：立即读一次，之后只在获焦 / 重新可见时读；返回取消函数。读取进行中不重复发起。 */
export function watchBranch(rootPath: string, emit: (value: GitBranch | null) => void,
  read: (rootPath: string) => Promise<GitBranch> = readGitBranch) {
  let active = true;
  let reading = false;
  const load = () => {
    if (!active || reading) return;
    reading = true;
    read(rootPath)
      .then((value) => { if (active) emit(value); })
      .catch(() => { if (active) emit(null); })
      .finally(() => { reading = false; });
  };
  const onVisible = () => { if (document.visibilityState === "visible") load(); };
  window.addEventListener("focus", load);
  document.addEventListener("visibilitychange", onVisible);
  load();
  return () => { active = false; window.removeEventListener("focus", load); document.removeEventListener("visibilitychange", onVisible); };
}

/** 面包屑要显示的文字：分支名；分离 HEAD 时是短提交号；非仓库 / 读不到时 null。 */
export function branchLabel(value: GitBranch | null): { text: string; detached: boolean } | null {
  if (!value?.repository) return null;
  if (value.branch) return { text: value.branch, detached: false };
  if (value.detached) return { text: value.detached, detached: true };
  return null;
}
