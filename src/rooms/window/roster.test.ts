import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "../../collab/contracts";
import { memberPresence } from "../model";
import { toRoomTabViews } from "./roster";

function snapshot(over: Partial<SessionSnapshot>): SessionSnapshot {
  return {
    tabId: "t-1", name: null, title: "会话", agent: "claude",
    activity: "idle", canReceive: true, projectRoot: "/p", ...over,
  };
}

describe("toRoomTabViews", () => {
  it("还原出的在场判定和主窗口一致：空闲 / 正忙 / 离线", () => {
    const views = toRoomTabViews([
      snapshot({}),
      snapshot({ tabId: "t-2", activity: "working", canReceive: false }),
      snapshot({ tabId: "t-3", activity: "idle", canReceive: false }),
    ]);
    expect(views.map((view) => memberPresence(view))).toEqual(["online", "busy", "offline"]);
  });

  it("名字与标题原样带过：成员行要用它们显示", () => {
    const [view] = toRoomTabViews([snapshot({ name: "前端", title: "改登录页" })]);
    expect(view.agentName).toBe("前端");
    expect(view.title).toBe("改登录页");
    expect(view.kind).toBe("claude");
  });
});
