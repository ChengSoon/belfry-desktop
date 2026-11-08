import { getLocale, t, useTranslation } from "../i18n";
import { useCallback, useMemo, useState } from "react";
import { buildQuickOpenItems } from "./items";
import type { QuickOpenItem } from "./model";
import type { RecentProject, WorkspaceTab } from "../workspace/contracts";
import { usePluginRuntime } from "../plugins/usePluginRuntime";
import { pluginCommandItems } from "../plugins/runtimeCatalog";
import { pluginHost } from "../plugins/useDirectoryRegistry";
import { pluginNotice } from "../plugins/PluginRuntimeBridge";
import { pluginError } from "../plugins/hostClient";

interface QuickOpenActions {
  tabs: readonly WorkspaceTab[];
  recentProjects: readonly RecentProject[];
  activeTabId: string | null;
  activateTab: (id: string) => void;
  selectProject: (path: string) => Promise<void>;
}

/** Quick Open 的状态、条目快照和动作分发，避免把浮层细节塞进 App 总入口。 */
export function useQuickOpen(actions: QuickOpenActions) {
  useTranslation();
  const [open, setOpen] = useState(false);
  const plugins = usePluginRuntime();
  const items = useMemo(
    () => [...buildQuickOpenItems(actions.tabs, actions.recentProjects, actions.activeTabId), ...pluginCommandItems(plugins)],
    [actions.activeTabId, actions.recentProjects, actions.tabs, plugins, getLocale()],
  );
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);
  const select = useCallback((item: QuickOpenItem, onAction: (id: string) => void) => {
    setOpen(false);
    if (item.id.startsWith("plugin:")) {
      const command = plugins.commands.find((entry) => item.id === `plugin:${entry.pluginId}:${entry.id}`);
      if (command) void pluginHost.runCommand(command.pluginId, command.id).catch((error) => pluginNotice(pluginError(error)));
      else pluginNotice(t("quickopen.useQuickOpen.text_f176f2dda6"));
      return;
    }
    if (item.kind === "session" && item.value) {
      actions.activateTab(item.value);
      return;
    }
    if (item.kind === "project" && item.value) {
      void actions.selectProject(item.value);
      return;
    }
    onAction(item.id);
  }, [actions, plugins]);

  return { close, items, open, select, toggle };
}
