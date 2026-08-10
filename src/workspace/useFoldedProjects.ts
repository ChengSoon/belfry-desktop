import { useCallback, useState } from "react";

/**
 * 侧栏项目折叠。属于展示状态所以不进 useProjectWorkspace，但要放在 Sidebar 之上——
 * ⌘B 收起侧栏会卸载 Sidebar，状态留在组件内会被重置。
 */
export function useFoldedProjects() {
  const [foldedProjects, setFoldedProjects] = useState<ReadonlySet<string>>(() => new Set());

  const toggleFold = useCallback((projectId: string) => {
    setFoldedProjects((current) => {
      const next = new Set(current);
      if (!next.delete(projectId)) next.add(projectId);
      return next;
    });
  }, []);

  const unfold = useCallback((projectId: string) => {
    setFoldedProjects((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  }, []);

  return { foldedProjects, toggleFold, unfold };
}
