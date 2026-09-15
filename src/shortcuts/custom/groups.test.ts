import { describe, expect, it } from "vitest";
import { SHORTCUT_ACTIONS } from "./actions";
import { groupShortcutActions, isSessionSwitch } from "./groups";

describe("groupShortcutActions", () => {
  it("每条动作都落进某一组，一条都不能丢", () => {
    const groups = groupShortcutActions(SHORTCUT_ACTIONS);
    const grouped = groups.flatMap((group) => group.actions.map((action) => action.id));
    const sorted = (ids: readonly string[]) => [...ids].sort();
    expect(sorted(grouped)).toEqual(sorted(SHORTCUT_ACTIONS.map((action) => action.id)));
  });

  it("没有动作重复出现在两组里", () => {
    const grouped = groupShortcutActions(SHORTCUT_ACTIONS)
      .flatMap((group) => group.actions.map((action) => action.id));
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("九条切换会话折成一组", () => {
    const sessions = groupShortcutActions(SHORTCUT_ACTIONS).find((group) => group.id === "sessions");
    expect(sessions?.collapsed).toBe(true);
    expect(sessions?.actions).toHaveLength(9);
    expect(sessions?.actions.every((action) => isSessionSwitch(action.id))).toBe(true);
  });

  it("目录新增未归组的动作时兜进「其它」，不会从界面上消失", () => {
    const extra = { id: "brand-new" as never, label: "新动作", code: "KeyZ" };
    const groups = groupShortcutActions([...SHORTCUT_ACTIONS, extra]);
    expect(groups.at(-1)).toMatchObject({ id: "other", actions: [extra] });
  });

  it("空组不渲染", () => {
    const groups = groupShortcutActions(SHORTCUT_ACTIONS.filter((action) => action.id === "new-shell"));
    expect(groups.map((group) => group.id)).toEqual(["workspace"]);
  });
});
