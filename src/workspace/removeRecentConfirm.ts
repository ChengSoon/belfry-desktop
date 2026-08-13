import type { RecentProject } from "./contracts";

/**
 * 删除最近项目的弹框正文。说清楚删除的边界：只动最近列表和已打开的会话，
 * 磁盘上的目录原封不动——把"删除"这件事真正会发生的代价列出来。
 */
export function removeRecentConfirmBody(project: RecentProject, openTabCount: number) {
  const closingClause = openTabCount > 0
    ? `，并关闭该目录下的 ${openTabCount} 个会话`
    : "";
  return `将从最近项目中移除 ${project.name}${closingClause}。目录本身不会被删除。`;
}
