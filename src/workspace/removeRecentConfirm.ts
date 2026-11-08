import { t } from "../i18n";
import type { RecentProject } from "./contracts";

/**
 * 删除最近项目的弹框正文。说清楚删除的边界：只动最近列表和已打开的会话，
 * 磁盘上的目录原封不动——把"删除"这件事真正会发生的代价列出来。
 */
export function removeRecentConfirmBody(project: RecentProject, openTabCount: number) {
  return t(openTabCount > 0 ? "workspace.removeRecentConfirm.withSessions" : "workspace.removeRecentConfirm.onlyRecent", { name: project.name, count: openTabCount });
}
