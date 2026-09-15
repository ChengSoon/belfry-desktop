import { useCallback } from "react";
import { isAgentKind } from "../agent/contracts";
import type { TerminalSnapshot } from "../components/TerminalViewport";
import { closeTerminalTab } from "../terminal/api";
import { sshDisplayName, type SshLaunch } from "../terminal/contracts";
import { toAppFailure } from "./errors";
import { applySnapshot, updateSshTarget } from "./tabs";
import type { WorkspaceState } from "./useWorkspaceState";

export function useWorkspaceTabActions({ setTabs, setFailure }: WorkspaceState) {
  const closeTab = useCallback((id: string) => {
    void closeTerminalTab(id).then(() => setTabs((current) => current.filter((tab) => tab.id !== id)))
      .catch((error) => setFailure(toAppFailure(error)));
  }, [setFailure, setTabs]);
  // SSH 的显示名独立于 Agent 的协作寻址名，后续快照不能覆盖它。
  const renameTab = useCallback((id: string, customTitle: string | null) => {
    setTabs((current) => current.map((tab) => {
      if (tab.id !== id || tab.kind !== "ssh") return tab;
      const fallback = tab.sshTarget ? sshDisplayName(tab.sshTarget) : tab.title;
      const title = customTitle?.trim() || fallback;
      return { ...tab, title, customTitle: title === fallback ? null : title };
    }));
  }, [setTabs]);
  const renameAgent = useCallback((id: string, agentName: string | null) => {
    setTabs((current) => current.map((tab) => (
      tab.id === id && isAgentKind(tab.kind) ? { ...tab, agentName } : tab
    )));
  }, [setTabs]);
  const updateSsh = useCallback((id: string, target: SshLaunch) => {
    void closeTerminalTab(id).then(() => setTabs((current) => current.map((tab) => (
      tab.id === id ? updateSshTarget(tab, target) : tab
    )))).catch((error) => setFailure(toAppFailure(error)));
  }, [setFailure, setTabs]);
  const updateTab = useCallback((id: string, snapshot: TerminalSnapshot) => {
    setTabs((current) => current.map((tab) => tab.id === id ? applySnapshot(tab, snapshot) : tab));
  }, [setTabs]);
  return { closeTab, renameTab, renameAgent, updateSsh, updateTab };
}
