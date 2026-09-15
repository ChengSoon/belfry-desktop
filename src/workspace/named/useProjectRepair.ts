import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { openProject } from "../api";
import type { WorkspaceTab } from "../contracts";
import { toAppFailure } from "../errors";
import { canRepairProject, repairTabProject, requestProjectRepair } from "./repair";
import { configureRestoredTabs } from "../projects/launch";
import { closeTerminalTab } from "../../terminal/api";

export function useProjectRepair(tabs: WorkspaceTab[], setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>) {
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  return useCallback(async (id: string, path: string | null) => {
    try {
      await requestProjectRepair(path, {
        current: () => tabsRef.current.find((tab) => tab.id === id) ?? null,
        open: openProject,
        beforeApply: (tab) => closeTerminalTab(tab.id),
        // 最后一次检查位于 updater 内，迟到快照已启动终端时原样保留。
        apply: (expected, project) => {
          const prepared = configureRestoredTabs([repairTabProject(expected, project)])[0];
          setTabs((current) => current.map((tab) => tab === expected && canRepairProject(tab) ? prepared : tab));
        },
      });
      return null;
    } catch (error) { return toAppFailure(error).message; }
  }, [setTabs]);
}
