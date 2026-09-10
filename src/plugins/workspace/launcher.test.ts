import { describe, expect, it } from "vitest";
import { searchLaunchablePlugins } from "./plugin-launcher-search";
import type { PluginSummary } from "../center/types";

const plugin = (id: string, name: string, enabled = true): PluginSummary => ({
  id, name, version: "1.0.0", enabled, status: "ready", source: "installed", permissions: ["ui.panel"], ui: { panel: "index.html" },
});
describe("原版插件启动器", () => {
  const todo = plugin("pi.todo", "小清新待办"), logs = plugin("pi.logs", "日志查看器");
  it("支持名称、拼音及首字母，隐藏已停用插件", () => {
    expect(searchLaunchablePlugins([todo, logs], "rizhi")).toEqual([logs]);
    expect(searchLaunchablePlugins([todo, logs], "xqxdb")).toEqual([todo]);
    expect(searchLaunchablePlugins([plugin("off", "日志", false)], "日志")).toEqual([]);
  });
  it("在无查询时优先展示最近使用的插件", () => {
    expect(searchLaunchablePlugins([todo, logs], "", [todo.id]).map((item) => item.id)).toEqual([todo.id, logs.id]);
  });
});
