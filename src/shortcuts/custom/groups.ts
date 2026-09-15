import type { ShortcutAction } from "./actions";
import type { ActionId } from "./contracts";

/**
 * 快捷键按用途分组。
 *
 * 设置页原先把 16 条设置平铺成一张长表，眼睛没有任何落点。这里给出的分组
 * 与「快捷指令」浮层（shortcuts/catalog.ts 的 belfrySections）同一套语义——
 * 同一个动作在两处读起来必须是同一件事，否则用户得在脑子里维护两份地图。
 *
 * 「切换会话」那 9 条是同一件事的 9 个序号，逐条列出既没有信息量又占掉半页，
 * 由 `collapsed` 标出，交给 UI 折成一行。
 */
export interface ShortcutGroup {
  id: string;
  label: string;
  /** 该组的动作按目录顺序排列。 */
  actions: ShortcutAction[];
  /** true 表示这组适合折成一行展示（只有序号不同的同类动作）。 */
  collapsed?: boolean;
}

const PANEL_ACTIONS: ActionId[] = ["toggle-sidebar", "toggle-usage", "toggle-history"];
const NAV_ACTIONS: ActionId[] = ["toggle-quick-open", "toggle-shortcuts", "open-settings"];

export function isSessionSwitch(id: ActionId) {
  return id.startsWith("activate-session-");
}

export function groupShortcutActions(actions: ShortcutAction[]): ShortcutGroup[] {
  const pick = (ids: ActionId[]) => ids
    .map((id) => actions.find((action) => action.id === id))
    .filter((action): action is ShortcutAction => Boolean(action));

  // 会话组既有「新建」也有 9 条「切换第 N 个」，但前者是独立动作、后者是序号族，
  // 分成两组：前者照常一行一条，后者折起来。
  const sessionSwitches = actions.filter((action) => isSessionSwitch(action.id));
  const groups: ShortcutGroup[] = [
    { id: "workspace", label: "工作区", actions: pick(["new-shell"]) },
    { id: "panels", label: "面板", actions: pick(PANEL_ACTIONS) },
    { id: "navigation", label: "导航", actions: pick(NAV_ACTIONS) },
    { id: "sessions", label: "切换会话", actions: sessionSwitches, collapsed: true },
  ];

  // 目录里新增了动作却忘了归组时，兜到「其它」——宁可多一组，也不要让一条设置
  // 从界面上凭空消失。
  const grouped = new Set(groups.flatMap((group) => group.actions.map((action) => action.id)));
  const rest = actions.filter((action) => !grouped.has(action.id));
  if (rest.length) groups.push({ id: "other", label: "其它", actions: rest });

  return groups.filter((group) => group.actions.length > 0);
}
