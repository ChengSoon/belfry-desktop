import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentKind, AppFailure } from "../workspace/contracts";
import { toAppFailure } from "../workspace/errors";
import { fetchAgentReleases, installAgentRelease } from "./api";
import type { AgentRelease, AgentReleaseInstall } from "./contracts";

/**
 * 关于页的 Agent CLI 数据：本地版本 + registry 最新版本 + 安装/升级。
 *
 * 打开时才拉，不在应用启动时付这笔钱（要跑三个 CLI 的本地探测和 registry 查询）。
 */
export function useAgentReleases(open: boolean) {
  const [releases, setReleases] = useState<AgentRelease[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<AgentKind | null>(null);
  const [failure, setFailure] = useState<AppFailure | null>(null);
  const [result, setResult] = useState<AgentReleaseInstall | null>(null);
  // 刷新与安装会并发，慢的那个回来时不能把新状态盖回去。
  const requestVersion = useRef(0);

  const run = useCallback(
    async <T,>(task: () => Promise<T>, apply: (value: T) => void): Promise<T | undefined> => {
      const version = ++requestVersion.current;
      setLoading(true);
      setFailure(null);
      try {
        const value = await task();
        if (version !== requestVersion.current) return undefined;
        apply(value);
        return value;
      } catch (error) {
        if (version === requestVersion.current) setFailure(toAppFailure(error));
        return undefined;
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [],
  );

  const refresh = useCallback(() => run(fetchAgentReleases, setReleases), [run]);

  const install = useCallback(
    async (kind: AgentKind) => {
      setInstalling(kind);
      setResult(null);
      try {
        const outcome = await installAgentRelease(kind);
        setResult(outcome);
        // 安装完重拉一遍：后端会重新探测，卡片上的版本号即时刷新。
        if (outcome.success) void refresh();
        return outcome;
      } catch (error) {
        setFailure(toAppFailure(error));
        return null;
      } finally {
        setInstalling(null);
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  return { releases, loading, installing, failure, result, refresh, install, dismissFailure: () => setFailure(null) };
}
