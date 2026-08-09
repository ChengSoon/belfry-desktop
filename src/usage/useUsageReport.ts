import { useCallback, useEffect, useRef, useState } from "react";
import type { AppFailure } from "../workspace/contracts";
import { toAppFailure } from "../workspace/errors";
import { fetchUsageReport } from "./api";
import type { UsageReport, UsageWindow } from "./contracts";

interface UseUsageReportOptions {
  /** 面板关闭时不扫描日志，避免白付一次全盘 IO。 */
  enabled: boolean;
  /** null 表示统计全部项目。 */
  projectRoot: string | null;
}

export function useUsageReport({ enabled, projectRoot }: UseUsageReportOptions) {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [windowDays, setWindowDays] = useState<UsageWindow>(30);
  const [scoped, setScoped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<AppFailure | null>(null);
  const requestVersion = useRef(0);

  const scopeRoot = scoped ? projectRoot : null;

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setFailure(null);
    try {
      const next = await fetchUsageReport({ windowDays, projectRoot: scopeRoot });
      // 丢弃过期响应：切换窗口/范围时旧请求可能后到。
      if (version !== requestVersion.current) return;
      setReport(next);
    } catch (error) {
      if (version === requestVersion.current) setFailure(toAppFailure(error));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [scopeRoot, windowDays]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  // 项目未就绪时无法按项目过滤，退回全局，避免显示空数据。
  useEffect(() => {
    if (!projectRoot) setScoped(false);
  }, [projectRoot]);

  return {
    report,
    windowDays,
    setWindowDays,
    scoped,
    setScoped,
    loading,
    failure,
    reload: load,
    canScope: Boolean(projectRoot),
  };
}
