import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentKind } from "../../workspace/contracts";
import { toAppFailure } from "../../workspace/errors";
import { readProjectProviders, selectProjectProvider } from "./api";
import type { ProjectProviderReport } from "./contracts";

interface State { root: string | null; report: ProjectProviderReport | null; busy: boolean; failure: string | null }

export function useProjectProviders(root: string | null) {
  const [state, setState] = useState<State>({ root, report: null, busy: false, failure: null });
  const generation = useRef(0);
  const run = useCallback(async (task: () => Promise<ProjectProviderReport>) => {
    const current = ++generation.current;
    setState((state) => ({ root, report: state.root === root ? state.report : null, busy: true, failure: null }));
    try {
      const report = await task();
      if (current === generation.current) setState({ root, report, busy: false, failure: null });
    } catch (error) {
      if (current === generation.current) setState((state) => ({ ...state, busy: false, failure: toAppFailure(error).message }));
    }
  }, [root]);
  const reload = useCallback(() => { if (root) void run(() => readProjectProviders(root)); }, [root, run]);
  useEffect(() => {
    reload();
    return () => { generation.current += 1; };
  }, [reload]);
  const select = (kind: AgentKind, providerId: string | null) => {
    if (root) void run(() => selectProjectProvider({ rootPath: root, kind, providerId }));
  };
  const current = state.root === root ? state : { root, report: null, busy: Boolean(root), failure: null };
  return { ...current, reload, select };
}
