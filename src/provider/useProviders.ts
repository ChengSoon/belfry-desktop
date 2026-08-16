import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentKind, AppFailure } from "../workspace/contracts";
import { toAppFailure } from "../workspace/errors";
import { listProviders, removeProvider, saveProvider, switchProvider, syncLiveProvider } from "./api";
import { AGENT_LABEL, type ProviderCatalog, type ProviderDraft } from "./contracts";

export function useProviders(open: boolean) {
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<AppFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 切换和读取会并发，慢的那个回来时不能把新状态盖回去。
  const requestVersion = useRef(0);

  const run = useCallback(
    async <T,>(
      task: () => Promise<T>,
      apply: (result: T) => void,
    ): Promise<T | undefined> => {
      const version = ++requestVersion.current;
      setLoading(true);
      setFailure(null);
      try {
        const result = await task();
        if (version !== requestVersion.current) return undefined;
        apply(result);
        return result;
      } catch (error) {
        if (version === requestVersion.current) setFailure(toAppFailure(error));
        return undefined;
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [],
  );

  const reload = useCallback(() => run(listProviders, setCatalog), [run]);

  // 打开时才拉：这份数据要读两个 CLI 的配置文件，还要跑一次登录 shell 环境比对，
  // 没必要在应用启动时就付这笔钱。
  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const save = useCallback(
    (kind: AgentKind, draft: ProviderDraft) => run(() => saveProvider(kind, draft), setCatalog),
    [run],
  );

  const remove = useCallback(
    (kind: AgentKind, id: string) => run(() => removeProvider(kind, id), setCatalog),
    [run],
  );

  const select = useCallback(
    (kind: AgentKind, id: string | null) =>
      run(
        () => switchProvider(kind, id),
        (outcome) => {
          setCatalog(outcome.catalog);
          setNotice(
            outcome.effectiveImmediately
              ? `${AGENT_LABEL[kind]} 已切换，立即生效。`
              : `${AGENT_LABEL[kind]} 已切换。新开的会话会用上，已经在跑的要重开才生效。`,
          );
        },
      ),
    [run],
  );

  /** 配置文件被手动编辑后调用：把 live 配置同步进库，列表跟着更新。 */
  const syncLive = useCallback(
    (kind: AgentKind) => run(() => syncLiveProvider(kind), setCatalog),
    [run],
  );

  return {
    catalog,
    dismissFailure: () => setFailure(null),
    dismissNotice: () => setNotice(null),
    failure,
    loading,
    notice,
    reload,
    remove,
    save,
    select,
    syncLive,
  };
}
